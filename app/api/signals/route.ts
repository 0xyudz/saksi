import type { NextRequest } from "next/server";

import { authorizePayment } from "@/integrations/x402/seller";
import { assertSameOrigin, handleRoute, jsonResponse } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { formatAtomic } from "@/lib/price";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { requireSellerUserId } from "@/server/auth";
import { listListedSignals } from "@/server/data/listings";
import { publishSignal, publishSignalSchema } from "@/server/usecases/publish-signal";
import type { HTTPResponseInstructions } from "@x402/core/server";

export const dynamic = "force-dynamic";
/** Tatum verification of the listing fee can exceed the platform default. */
export const maxDuration = 60;

function paymentResponse(instructions: HTTPResponseInstructions, requestId: string): Response {
  const headers = new Headers(instructions.headers);
  headers.set("x-request-id", requestId);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  const body =
    typeof instructions.body === "string"
      ? instructions.body
      : JSON.stringify(instructions.body ?? {});
  return new Response(body, { status: instructions.status, headers });
}

/** The public catalogue: only listings whose fee has settled are visible. */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const items = await listListedSignals();
    return jsonResponse(
      {
        signals: items.map((item) => ({
          id: item.signal.id,
          provider: item.signal.provider,
          sellerHandle: item.sellerHandle,
          title: item.signal.title,
          priceAtomic: item.signal.priceAtomic.toString(),
          priceUsd: formatAtomic(item.signal.priceAtomic),
          asset: item.signal.asset,
          purchases: item.purchases,
          createdAt: item.signal.createdAt.toISOString(),
        })),
      },
      requestId,
    );
  });
}

const publishRequestSchema = publishSignalSchema;

/**
 * Publishes a signal. Two gates, in this order:
 *
 * 1. The caller must own a journal with a proven wallet, because that wallet is where
 *    buyers will pay. No allowlist: any journal that proved a wallet may sell.
 * 2. The request must carry a settled x402 payment of the listing fee to the platform.
 *    The x402 layer settles it before the handler runs, and `publishSignal` re-verifies
 *    the digest against Tatum before the row is written.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    assertWithinRateLimit(request, "signals:publish", 10, 60_000);

    const seller = await requireSellerUserId();

    const authorization = await authorizePayment(request);
    if (authorization.kind === "payment-required") {
      return paymentResponse(authorization.result.response, requestId);
    }

    const digest = authorization.settlement.transaction;
    if (!digest) {
      throw new AppError("PAYMENT_NOT_VERIFIED", "The listing settlement returned no digest.");
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = publishRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "The listing payload is invalid.", {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      });
    }

    const published = await publishSignal(seller, { ...parsed.data, digest });

    const headers = new Headers(authorization.settlement.headers);
    headers.set("cache-control", "no-store");

    return jsonResponse(
      {
        signal: {
          id: published.signal.id,
          title: published.signal.title,
          provider: published.signal.provider,
          externalRef: published.signal.externalRef,
          priceAtomic: published.signal.priceAtomic.toString(),
          payToAddress: published.signal.payToAddress,
          createdAt: published.signal.createdAt.toISOString(),
        },
        listingFee: {
          digest,
          amountAtomic: published.listingFeeAtomic.toString(),
          explorerUrl: published.explorerUrl,
        },
      },
      requestId,
      { status: 201, headers },
    );
  });
}
