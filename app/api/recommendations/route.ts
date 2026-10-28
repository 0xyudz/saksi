import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { recommend, recommendSchema } from "@/server/usecases/recommend";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const userId = await requireApiUserId();
    const input = await parseJsonBody(request, recommendSchema);
    const recommendation = await recommend(userId, input);
    return jsonResponse({ recommendation }, requestId, { status: 201 });
  });
}
