import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { requireApiUserId } from "@/server/auth";
import { bindWalletSchema, bindWalletToUser } from "@/server/data/users";

export const dynamic = "force-dynamic";

/**
 * Attaches a wallet to the signed-in journal.
 *
 * This exists for journals created before wallet auth: their handles are already claimed
 * and cannot be re-created, so they need a path to gain a payout address. A journal that
 * already has a wallet cannot be rebound, because that would silently redirect where
 * buyers send money.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:wallet-bind", 10, 60_000);
    const userId = await requireApiUserId();
    const input = await parseJsonBody(request, bindWalletSchema);
    const user = await bindWalletToUser(userId, input);

    return jsonResponse(
      {
        user: { id: user.id, handle: user.handle, walletAddress: user.walletAddress },
      },
      requestId,
    );
  });
}
