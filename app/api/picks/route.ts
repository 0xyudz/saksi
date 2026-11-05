import { z } from "zod";

import {
  assertSessionOrigin,
  handleRoute,
  jsonResponse,
  parseJsonBody,
  parseQuery,
} from "@/lib/http";
import { optionalApiUserId, requireApiUserId } from "@/server/auth";
import { labelForRef, readJournalHandles } from "@/server/data/journal";
import { recentPicks } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";
import { createPick, createPickSchema } from "@/server/usecases/create-pick";

export const dynamic = "force-dynamic";
/** Walrus recall/write and Tatum verification can exceed the platform default. */
export const maxDuration = 60;

const listQuerySchema = z.object({
  mine: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const query = parseQuery(request, listQuerySchema);
    const viewerId = await optionalApiUserId();
    const mine = query.mine === "true";

    if (mine && !viewerId) {
      return jsonResponse({ picks: [] }, requestId);
    }

    const feed = await recentPicks(query.limit, mine ? viewerId : undefined);
    const handles = await readJournalHandles(feed.map((item) => item.journalRef));
    const now = new Date();

    return jsonResponse(
      {
        picks: feed.map((item) =>
          presentPick({
            pick: item.pick,
            viewerId,
            ownerHandle: labelForRef(item.journalRef, handles),
            analystName: item.analystName,
            analystKind: item.analystKind,
            outcome:
              item.outcome === null
                ? null
                : {
                    result: item.outcome.result,
                    resolvedAt: item.outcome.resolvedAt,
                    sourceUrl: item.outcome.sourceUrl,
                    resolvedBy: item.outcome.resolvedBy,
                    brier: item.outcome.brier,
                    payoutUnits: null,
                  },
            now,
          }),
        ),
      },
      requestId,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const userId = await requireApiUserId();
    const input = await parseJsonBody(request, createPickSchema);
    const created = await createPick(userId, input);

    return jsonResponse(
      {
        pick: {
          id: created.pick.id,
          commitmentHash: created.commitmentHash,
          status: created.pick.status,
          committedAt: created.pick.committedAt.toISOString(),
        },
        memory: {
          blobId: created.blobId,
          jobId: created.jobId,
          namespace: created.namespace,
        },
      },
      requestId,
      { status: 201 },
    );
  });
}
