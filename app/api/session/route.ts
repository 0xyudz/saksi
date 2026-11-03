import { z } from "zod";

import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { clearSession, getSessionUser, startSession } from "@/lib/session";
import {
  claimJournal,
  claimJournalSchema,
  resumeSchema,
  resumeUser,
  type CreatedUser,
} from "@/server/data/users";
import { issueWalletChallenge, WALLET_CHALLENGE_PURPOSES } from "@/server/wallet-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const user = await getSessionUser();
    return jsonResponse({ user }, requestId);
  });
}

const challengeSchema = z.object({
  address: z.string().trim().min(1).max(80),
  purpose: z.enum(WALLET_CHALLENGE_PURPOSES),
  subject: z.string().trim().min(1).max(80).optional(),
});

/**
 * Issues the message a wallet must sign. This endpoint writes nothing except a
 * single-use nonce, so it is safe to call before any identity is established.
 */
export async function PUT(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:challenge", 30, 60_000);
    const input = await parseJsonBody(request, challengeSchema);

    const challenge = await issueWalletChallenge({
      address: input.address,
      purpose: input.purpose,
      subject: input.subject ?? null,
    });

    return jsonResponse(
      {
        challenge: {
          nonce: challenge.nonce,
          address: challenge.address,
          purpose: challenge.purpose,
          subject: challenge.subject,
          message: challenge.message,
          expiresAt: challenge.expiresAt,
        },
      },
      requestId,
    );
  });
}

/**
 * Creates a journal from a proven wallet. The recovery code is returned exactly once and
 * is the only fallback if the wallet is later lost.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:claim", 10, 60_000);
    const input = await parseJsonBody(request, claimJournalSchema);
    const created: CreatedUser = await claimJournal(input);
    await startSession(created.user.id);

    return jsonResponse(
      {
        user: {
          id: created.user.id,
          handle: created.user.handle,
          walletAddress: created.user.walletAddress,
        },
        // Shown once. There is no endpoint that can reveal it again, by design.
        recoveryCode: created.recoveryCode,
      },
      requestId,
      { status: 201 },
    );
  });
}

/** Resumes an existing journal with its handle and recovery code. */
export async function PATCH(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:resume", 10, 60_000);
    const input = await parseJsonBody(request, resumeSchema);
    const user = await resumeUser(input);
    await startSession(user.id);

    return jsonResponse(
      {
        user: { id: user.id, handle: user.handle, walletAddress: user.walletAddress },
      },
      requestId,
    );
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    await clearSession();
    return jsonResponse({ ok: true }, requestId);
  });
}
