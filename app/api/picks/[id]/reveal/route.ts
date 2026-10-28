import { z } from "zod";

import { AppError } from "@/lib/errors";
import { assertSameOrigin, handleRoute, jsonResponse } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { getPickDetail } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";
import { revealPick } from "@/server/usecases/reveal-pick";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const userId = await requireApiUserId();
    const parsed = idSchema.safeParse((await params).id);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid pick id.");

    const revealed = await revealPick(userId, parsed.data);
    const detail = await getPickDetail(parsed.data);
    if (!detail) throw new AppError("INTERNAL", "Revealed pick could not be read back.");

    return jsonResponse(
      {
        verified: revealed.verified,
        pick: presentPick({
          pick: detail.pick,
          viewerId: userId,
          ownerHandle: detail.ownerHandle,
          analystName: detail.analystName,
          analystKind: detail.analystKind,
          outcome:
            detail.outcome === null
              ? null
              : {
                  result: detail.outcome.result,
                  resolvedAt: detail.outcome.resolvedAt,
                  sourceUrl: detail.outcome.sourceUrl,
                  brier: detail.outcome.brier,
                  payoutUnits: detail.outcome.payoutUnits,
                },
        }),
      },
      requestId,
    );
  });
}
