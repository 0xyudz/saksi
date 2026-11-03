import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { startSession } from "@/lib/session";
import { loginWithWallet, loginWithWalletSchema } from "@/server/data/users";

export const dynamic = "force-dynamic";

/**
 * Signs a returning seller in with the wallet already bound to their journal.
 *
 * No handle is needed: `users.wallet_address` is unique, so a proven address identifies
 * exactly one journal. The proof is a signed challenge with purpose `login`, which cannot
 * be replayed as a claim or a bind because the purpose is part of the signed message.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:wallet-login", 10, 60_000);
    const input = await parseJsonBody(request, loginWithWalletSchema);
    const user = await loginWithWallet(input);
    await startSession(user.id);

    return jsonResponse(
      {
        user: { id: user.id, handle: user.handle, walletAddress: user.walletAddress },
      },
      requestId,
    );
  });
}
