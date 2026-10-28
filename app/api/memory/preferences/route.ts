import { z } from "zod";

import { assertSameOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { savePreference } from "@/server/data/memory";

export const dynamic = "force-dynamic";

const preferenceSchema = z.object({
  statement: z.string().trim().min(1).max(400),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const userId = await requireApiUserId();
    const input = await parseJsonBody(request, preferenceSchema);
    const memory = await savePreference(userId, input.statement);
    return jsonResponse({ memory }, requestId, { status: 201 });
  });
}
