import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { startSession } from "@/lib/session";
import { loginWithWallet, loginWithWalletSchema } from "@/server/data/journal";

export const dynamic = "force-dynamic";

/**
 * Signs a returning journal in with the wallet that owns it.
 *
 * No handle is needed and nothing is looked up by similarity: the proven address *is* the
 * journal's ref, so the signature alone identifies it. The proof is a signed challenge with
 * purpose `login`, which cannot be replayed as a claim because the purpose is part of the
 * signed message.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:wallet-login", 10, 60_000);
    const input = await parseJsonBody(request, loginWithWalletSchema);
    const journal = await loginWithWallet(input);
    await startSession(journal.ref);

    return jsonResponse(
      {
        user: { id: journal.ref, handle: journal.handle, walletAddress: journal.walletAddress },
      },
      requestId,
    );
  });
}
