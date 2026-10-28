import { z } from "zod";

import { SUI_DIGEST_PATTERN } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { optionalApiUserId } from "@/server/auth";
import { pickForUser } from "@/server/data/picks";
import { verifyAndRecordSignalPayment } from "@/server/usecases/purchase-signal";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  signalId: z.string().uuid(),
  digest: z.string().regex(SUI_DIGEST_PATTERN, "expected a Sui transaction digest"),
  pickId: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await parseJsonBody(request, verifySchema);
    const userId = await optionalApiUserId();

    if (input.pickId) {
      if (!userId) {
        throw new AppError("UNAUTHORIZED", "Attach a journal before linking a payment to a pick.");
      }
      const pick = await pickForUser(input.pickId, userId);
      if (!pick) throw new AppError("NOT_FOUND", "That pick does not belong to this journal.");
    }

    const verified = await verifyAndRecordSignalPayment({
      signalId: input.signalId,
      digest: input.digest,
      ...(userId === undefined ? {} : { userId }),
      ...(input.pickId === undefined ? {} : { pickId: input.pickId }),
    });

    return jsonResponse(
      {
        verified: true,
        verifiedBy: "tatum",
        payment: {
          id: verified.payment.id,
          digest: verified.digest,
          payer: verified.payer,
          amountAtomic: verified.amountAtomic,
          coinType: verified.coinType,
          explorerUrl: verified.explorerUrl,
          verifiedAt: verified.payment.verifiedAt.toISOString(),
        },
        memory: { blobIds: verified.memoryBlobIds },
      },
      requestId,
    );
  });
}
