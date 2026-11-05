import { z } from "zod";

import type { NextRequest } from "next/server";

import { REQUEST_ID_HEADER, SUI_DIGEST_PATTERN } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, handleRoute, jsonResponse } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { requireSellerUserId } from "@/server/auth";
import { listingFeeUsed } from "@/server/data/listings";
import { recoverListing, recoverListingSchema } from "@/server/usecases/publish-signal";

export const dynamic = "force-dynamic";
/** Tatum indexing and verification can exceed the platform default. */
export const maxDuration = 60;

const statusQuerySchema = z.object({ digest: z.string().trim().regex(SUI_DIGEST_PATTERN) });

/**
 * Whether a listing fee has already been turned into a listing.
 *
 * Publishing settles the fee and then writes the row, so a crash or an indexing delay
 * between the two leaves a paid digest with no listing. This read lets the browser ask
 * what happened before it pays again.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertWithinRateLimit(request, "signals:recover:status", 30, 60_000);
    await requireSellerUserId();

    const parsed = statusQuerySchema.safeParse({
      digest: request.nextUrl.searchParams.get("digest") ?? "",
    });
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "A valid settlement digest is required.");
    }

    return jsonResponse({ used: await listingFeeUsed(parsed.data.digest) }, requestId);
  });
}

/**
 * Publishes the listing for a fee that was already settled, without charging again.
 *
 * This exists because the fee is taken before the row is written: without it, a failure
 * after settlement would charge the seller for a listing that can never be created, and
 * the digest could never be reused. The payment is proven again from chain rather than
 * trusted from the request, and a settled digest still publishes exactly one listing.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    assertWithinRateLimit(request, "signals:recover", 10, 60_000);

    const seller = await requireSellerUserId();

    const raw: unknown = await request.json().catch(() => null);
    const parsed = recoverListingSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "The listing payload is invalid.", {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      });
    }

    const recovered = await recoverListing(seller, parsed.data);
    const headers = new Headers();
    headers.set("cache-control", "no-store");
    headers.set(REQUEST_ID_HEADER, requestId);

    return jsonResponse(
      {
        signal: {
          id: recovered.signal.id,
          title: recovered.signal.title,
          provider: recovered.signal.provider,
          externalRef: recovered.signal.externalRef,
          priceAtomic: recovered.signal.priceAtomic.toString(),
          payToAddress: recovered.signal.payToAddress,
          createdAt: recovered.signal.createdAt.toISOString(),
        },
        listingFee: {
          digest: recovered.listingFeeDigest,
          amountAtomic: recovered.listingFeeAtomic.toString(),
          explorerUrl: recovered.explorerUrl,
        },
        recovered: recovered.recovered,
      },
      requestId,
      { status: recovered.recovered ? 200 : 201, headers },
    );
  });
}
