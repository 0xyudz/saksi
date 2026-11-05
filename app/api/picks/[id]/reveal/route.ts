import { z } from "zod";

import { AppError } from "@/lib/errors";
import { assertSessionOrigin, handleRoute, jsonResponse } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { labelForOne } from "@/server/data/journal";
import { getPickDetail } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";
import { revealPick } from "@/server/usecases/reveal-pick";

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

    const revealed = await revealPick(userId, parsed.data);
    const detail = await getPickDetail(parsed.data);
    if (!detail) throw new AppError("INTERNAL", "Revealed pick could not be read back.");

    return jsonResponse(
      {
        verified: revealed.verified,
        memory: { blobId: revealed.revealMemoryBlobId },
        pick: presentPick({
          pick: detail.pick,
          viewerId: userId,
          ownerHandle: await labelForOne(detail.ownerRef),
          analystName: detail.analystName,
          analystKind: detail.analystKind,
          outcome:
            detail.outcome === null
              ? null
              : {
                  result: detail.outcome.result,
                  resolvedAt: detail.outcome.resolvedAt,
                  sourceUrl: detail.outcome.sourceUrl,
                  resolvedBy: detail.outcome.resolvedBy,
                  brier: detail.outcome.brier,
                  payoutUnits: detail.outcome.payoutUnits,
                },
        }),
      },
      requestId,
    );
  });
}
