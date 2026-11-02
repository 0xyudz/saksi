import { z } from "zod";

import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { savePreference } from "@/server/data/memory";

export const dynamic = "force-dynamic";
/** Walrus recall/write and Tatum verification can exceed the platform default. */
export const maxDuration = 60;

const preferenceSchema = z.object({
  statement: z.string().trim().min(1).max(400),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const userId = await requireApiUserId();
    const input = await parseJsonBody(request, preferenceSchema);
    const memory = await savePreference(userId, input.statement);
    return jsonResponse({ memory }, requestId, { status: 201 });
  });
}
