import { z } from "zod";

import { SUI_DIGEST_PATTERN } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { optionalApiUserId } from "@/server/auth";
import { getPaymentByDigest } from "@/server/data/payments";
import { pickForUser } from "@/server/data/picks";
import { getSignal } from "@/server/usecases/read-signal";
import { verifyPaymentWithRetry } from "@/server/usecases/purchase-signal";

export const dynamic = "force-dynamic";
/** Walrus recall/write and Tatum verification can exceed the platform default. */
export const maxDuration = 60;

const verifySchema = z.object({
  signalId: z.string().uuid(),
  digest: z.string().regex(SUI_DIGEST_PATTERN, "expected a Sui transaction digest"),
  pickId: z.string().uuid().optional(),
});

/**
 * Read-only digest inspection. This endpoint verifies the transaction on-chain and
 * reports whether Saksi already recorded it; it never inserts a payment row and never
 * writes to Walrus Memory.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "payments:verify", 10, 60_000);
    const input = await parseJsonBody(request, verifySchema);
    const userId = await optionalApiUserId();

    if (input.pickId) {
      if (!userId) {
        throw new AppError("UNAUTHORIZED", "Attach a journal before linking a payment to a pick.");
      }
      const pick = await pickForUser(input.pickId, userId);
      if (!pick) throw new AppError("NOT_FOUND", "That pick does not belong to this journal.");
    }

    const env = getEnv();
    const signal = await getSignal(input.signalId);
    /*
     * A listed signal pays its seller, not the platform. Verifying every digest against
     * `X402_PAY_TO_ADDRESS` made a genuine seller payment look fraudulent; only catalogue
     * rows with no seller fall back to the platform address.
     */
    const payTo = signal.payToAddress ?? env.X402_PAY_TO_ADDRESS;
    const verified = await verifyPaymentWithRetry({
      digest: input.digest,
      payTo,
      minAmountAtomic: signal.priceAtomic,
      network: env.SUI_NETWORK,
    });
    const recorded = await getPaymentByDigest(input.digest);

    return jsonResponse(
      {
        verified: true,
        verifiedBy: "tatum",
        digest: verified.digest,
        payer: verified.payer,
        amountAtomic: verified.amountAtomic.toString(),
        coinType: verified.coinType,
        explorerUrl: verified.explorerUrl,
        recorded: recorded !== null,
        signalId: recorded?.signalId ?? null,
      },
      requestId,
    );
  });
}
