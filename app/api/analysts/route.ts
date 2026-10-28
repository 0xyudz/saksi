import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { createAnalyst, createAnalystSchema } from "@/server/data/analysts";
import { leaderboard } from "@/server/data/picks";
import { requireApiUserId } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const entries = await leaderboard();
    return jsonResponse(
      {
        analysts: entries.map((entry) => ({
          id: entry.analyst.id,
          name: entry.analyst.name,
          kind: entry.analyst.kind,
          externalRef: entry.analyst.externalRef,
          credibility: entry.credibility,
        })),
      },
      requestId,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    await requireApiUserId();
    const input = await parseJsonBody(request, createAnalystSchema);
    const analyst = await createAnalyst(input);
    return jsonResponse({ analyst }, requestId, { status: 201 });
  });
}
