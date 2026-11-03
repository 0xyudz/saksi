import { z } from "zod";

import { AppError } from "@/lib/errors";
import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { resolvePick, resolvePickSchema } from "@/server/usecases/resolve-pick";

export const dynamic = "force-dynamic";
/** Walrus recall/write and Tatum verification can exceed the platform default. */
export const maxDuration = 60;

const idSchema = z.string().uuid();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const userId = await requireApiUserId();
    const parsed = idSchema.safeParse((await params).id);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid pick id.");

    const input = await parseJsonBody(request, resolvePickSchema);
    const result = await resolvePick(userId, parsed.data, input);

    return jsonResponse(
      {
        pick: {
          id: result.pick.id,
          status: result.pick.status,
        },
        outcome: {
          id: result.outcome.id,
          result: result.outcome.result,
          sourceUrl: result.outcome.sourceUrl,
          resolvedAt: result.outcome.resolvedAt.toISOString(),
          brier: result.outcome.brier,
          /**
           * Whether an independent provider confirmed this claim. Returned so a caller can
           * tell "the oracle agreed" from "nobody checked" without a second request.
           */
          verification: result.outcome.verification,
          oracleResult: result.outcome.oracleResult,
          oracleNote: result.outcome.oracleNote,
        },
        oracle: result.oracle,
        memory: {
          outcomeBlobId: result.outcomeBlobId,
          biasBlobId: result.biasBlobId,
          biasPattern: result.biasPattern,
          sourceRoiBlobIds: result.sourceRoiBlobIds,
        },
      },
      requestId,
      { status: 201 },
    );
  });
}
