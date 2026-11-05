import { z } from "zod";

import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { clearSession, getSessionUser, startSession } from "@/lib/session";
import {
  claimJournal,
  claimJournalSchema,
  resumeJournal,
  resumeSchema,
  type CreatedJournal,
} from "@/server/data/journal";
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
 * Creates a journal from a proven wallet.
 *
 * A wallet that already has a journal is refused with `409`: a second claim would write a
 * second identity record with a different ref, and the ref decides the namespace, so the
 * journal's history would split in two. The handle is still a display name with no
 * uniqueness — only the wallet is checked.
 *
 * The recovery code is returned exactly once and is the only fallback if the wallet is lost.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:claim", 10, 60_000);
    const input = await parseJsonBody(request, claimJournalSchema);
    const created: CreatedJournal = await claimJournal(input);
    await startSession(created.journal.ref);

    return jsonResponse(
      {
        user: {
          id: created.journal.ref,
          handle: created.journal.handle,
          walletAddress: created.journal.walletAddress,
        },
        // Shown once. There is no endpoint that can reveal it again, by design.
        recoveryCode: created.recoveryCode,
        receipts: created.receipts,
      },
      requestId,
      { status: 201 },
    );
  });
}

/** Resumes an existing journal with its recovery code. */
export async function PATCH(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:resume", 10, 60_000);
    const input = await parseJsonBody(request, resumeSchema);
    const journal = await resumeJournal(input);
    await startSession(journal.ref);

    return jsonResponse(
      {
        user: { id: journal.ref, handle: journal.handle, walletAddress: journal.walletAddress },
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
