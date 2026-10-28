import type { HTTPResponseInstructions } from "@x402/core/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { REQUEST_ID_HEADER } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { handleRoute, jsonResponse } from "@/lib/http";
import { toJsonObject } from "@/lib/json";
import { parsePriceToAtomic } from "@/lib/price";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { authorizePayment } from "@/integrations/x402/seller";
import { optionalApiUserId } from "@/server/auth";
import { assertSignalPriceMatches } from "@/server/scoring/payment-binding";
import { getSignal } from "@/server/usecases/ingest-signal";
import { verifyAndRecordSignalPayment } from "@/server/usecases/purchase-signal";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

function paymentResponse(instructions: HTTPResponseInstructions, requestId: string): Response {
  const headers = new Headers(instructions.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  if (!headers.has("content-type")) {
    headers.set(
      "content-type",
      instructions.isHtml ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    );
  }
  const body =
    typeof instructions.body === "string"
      ? instructions.body
      : JSON.stringify(instructions.body ?? {});
  return new Response(body, { status: instructions.status, headers });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertWithinRateLimit(request, "signals:get", 30, 60_000);
    const parsed = idSchema.safeParse((await params).id);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid signal id.");

    // Read the signal and validate its price before the facilitator settles anything,
    // so an unknown or stale listing cannot take the buyer's money first.
    const signal = await getSignal(parsed.data);
    assertSignalPriceMatches(signal.priceAtomic, parsePriceToAtomic(getEnv().X402_PRICE));

    const authorization = await authorizePayment(request);
    if (authorization.kind === "payment-required") {
      return paymentResponse(authorization.result.response, requestId);
    }

    const digest = authorization.settlement.transaction;
    if (!digest) {
      throw new AppError("PAYMENT_NOT_VERIFIED", "The settlement did not return a digest.");
    }

    const userId = await optionalApiUserId();
    const verified = await verifyAndRecordSignalPayment({
      signalId: parsed.data,
      digest,
      signal,
      resource: authorization.resource,
      requirements: toJsonObject(authorization.paymentRequirements),
      ...(userId === undefined ? {} : { userId }),
    });

    const headers = new Headers(authorization.settlement.headers);
    headers.set("cache-control", "no-store");

    return jsonResponse(
      {
        signal: {
          id: verified.signal.id,
          externalRef: verified.signal.externalRef,
          provider: verified.signal.provider,
          title: verified.signal.title,
          payload: verified.signal.payload,
          priceAtomic: verified.signal.priceAtomic.toString(),
          asset: verified.signal.asset,
          createdAt: verified.signal.createdAt.toISOString(),
        },
        settlement: {
          digest: verified.digest,
          payer: verified.payer,
          explorerUrl: verified.explorerUrl,
          verifiedBy: "tatum",
          coinType: verified.coinType,
          amountAtomic: verified.amountAtomic,
        },
      },
      requestId,
      { headers },
    );
  });
}
