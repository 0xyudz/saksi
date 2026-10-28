import { z } from "zod";

import { AppError } from "@/lib/errors";
import { handleRoute, jsonResponse } from "@/lib/http";
import { optionalApiUserId } from "@/server/auth";
import { getPickDetail } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const parsed = idSchema.safeParse((await params).id);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid pick id.");

    const detail = await getPickDetail(parsed.data);
    if (!detail) throw new AppError("NOT_FOUND", "Pick not found.");

    const viewerId = await optionalApiUserId();
    const view = presentPick({
      pick: detail.pick,
      viewerId,
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
    });

    return jsonResponse({ pick: view }, requestId);
  });
}
