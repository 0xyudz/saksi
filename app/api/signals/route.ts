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

/*
 * The settlement digest is produced by `authorizePayment` below, not supplied by the
 * client, so the request schema must not require it. Requiring it rejected every listing
 * that reached validation, even after a successful payment.
 */
const publishRequestSchema = publishSignalSchema.omit({ digest: true });

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

    /*
     * Validate the listing before the fee is settled. `authorizePayment` calls the
     * facilitator, which moves the seller's money; running it first meant a malformed
     * body was rejected only after the listing fee had already been paid, with no listing
     * and no refund. The body does not influence the payment requirements, so reading it
     * first is safe.
     */
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

    const authorization = await authorizePayment(request);
    if (authorization.kind === "payment-required") {
      return paymentResponse(authorization.result.response, requestId);
    }

    const digest = authorization.settlement.transaction;
    if (!digest) {
      throw new AppError("PAYMENT_NOT_VERIFIED", "The listing settlement returned no digest.");
    }

    /*
     * The money has moved at this point. If writing the listing then fails, the error
     * response must still carry the settlement headers so the browser can learn the
     * digest and recover the listing it already paid for; without them the fee would be
     * lost with no way to claim it.
     */
    let published;
    try {
      published = await publishSignal(seller, { ...parsed.data, digest });
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(error.code, error.message, {
          cause: error,
          details: error.details,
          retryable: error.retryable,
          httpStatus: error.httpStatus,
          headers: authorization.settlement.headers,
        });
      }
      throw error;
    }

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
