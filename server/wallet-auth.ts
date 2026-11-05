import { randomBytes } from "node:crypto";

import { normalizeSuiAddress } from "@mysten/sui/utils";

import { getDb } from "@/db/client";
import { walletChallenges, type WalletChallengeRow } from "@/db/schema";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

import { AppError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { verifyPersonalMessageSignature } from "@/server/wallet-signature";

/**
 * Wallet ownership proofs.
 *
 * A Sui address on its own proves nothing: anyone can type someone else's address into a
 * form. The only thing that distinguishes "I control 0xabc" from "I know 0xabc" is a
 * signature over a message that Saksi issued, for a purpose Saksi chose, and that Saksi
 * has not seen before. That is what this module checks.
 *
 * Everything here fails closed. A malformed signature, an unknown nonce, a reused nonce
 * and an expired nonce are all reported as the same rejection, because distinguishing
 * them would tell an attacker which part of a forgery attempt was closest to working.
 */

/** Challenges are short-lived: long enough to sign, short enough to be useless if leaked. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Bound so a table scan cannot be driven by a client that never finishes a challenge. */
const MAX_OPEN_CHALLENGES_PER_ADDRESS = 5;

/**
 * `bind` is gone: a journal *is* its wallet, so there is no separate address to attach. A
 * wallet that has never signed cannot become a journal, and one that has needs no binding.
 */
export const WALLET_CHALLENGE_PURPOSES = ["claim", "login"] as const;
export type WalletChallengePurpose = (typeof WALLET_CHALLENGE_PURPOSES)[number];

export interface IssuedChallenge {
  readonly nonce: string;
  readonly address: string;
  readonly purpose: WalletChallengePurpose;
  readonly subject: string | null;
  readonly message: string;
  readonly expiresAt: string;
}

/**
 * The exact bytes a wallet is asked to sign.
 *
 * This text is part of the protocol, not decoration. It names the app, the action, the
 * address, the target and the nonce, so a user who is shown this prompt can see precisely
 * what they are authorising. Changing any line breaks verification of every signature
 * created before the change, so treat it as frozen.
 */
export function buildChallengeMessage(input: {
  readonly address: string;
  readonly purpose: WalletChallengePurpose;
  readonly subject: string | null;
  readonly nonce: string;
  readonly issuedAt: string;
}): string {
  return [
    "Saksi wants to verify that you control this Sui address.",
    "",
    `Address: ${input.address}`,
    `Action: ${input.purpose}`,
    `Target: ${input.subject ?? "(this wallet)"}`,
    `Nonce: ${input.nonce}`,
    `Issued: ${input.issuedAt}`,
    "",
    "This signature authorises no payment and cannot move funds.",
  ].join("\n");
}

export function normalizeAddress(address: string): string {
  return normalizeSuiAddress(address).toLowerCase();
}

/**
 * Refuses a proof that was issued for a different address than the one the caller
 * submitted.
 *
 * `consumeWalletChallenge` proves control of the address stored in the challenge, not of
 * whatever address appears in the request body. Without this comparison, a caller could
 * sign a challenge for their own wallet and then send a victim's address in the body,
 * turning a valid proof of A into a claim to B. Every caller that looks up or writes an
 * address must run this check against the returned proof.
 */
export function assertProofAddress(proofAddress: string, submittedAddress: string): void {
  if (normalizeAddress(submittedAddress) !== proofAddress) {
    throw new AppError("UNAUTHORIZED", "That wallet proof was issued for a different address.");
  }
}

function randomNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Issues a single-use challenge. Old challenges for the same address are pruned first so
 * an abandoned flow cannot accumulate rows.
 */
export async function issueWalletChallenge(input: {
  readonly address: string;
  readonly purpose: WalletChallengePurpose;
  readonly subject?: string | null;
}): Promise<IssuedChallenge> {
  const address = normalizeAddress(input.address);
  const subject = input.subject ?? null;
  const db = getDb();
  const now = new Date();

  await db
    .delete(walletChallenges)
    .where(and(eq(walletChallenges.address, address), lt(walletChallenges.expiresAt, now)));

  const open = await db
    .select({ id: walletChallenges.id })
    .from(walletChallenges)
    .where(
      and(
        eq(walletChallenges.address, address),
        isNull(walletChallenges.consumedAt),
        gt(walletChallenges.expiresAt, now),
      ),
    );

  if (open.length >= MAX_OPEN_CHALLENGES_PER_ADDRESS) {
    await db.delete(walletChallenges).where(eq(walletChallenges.id, open[0]?.id ?? ""));
  }

  const nonce = randomNonce();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const message = buildChallengeMessage({
    address,
    purpose: input.purpose,
    subject,
    nonce,
    issuedAt: now.toISOString(),
  });

  await db.insert(walletChallenges).values({
    address,
    nonce,
    purpose: input.purpose,
    subject,
    message,
    expiresAt,
  });

  return {
    nonce,
    address,
    purpose: input.purpose,
    subject,
    message,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Consumes a challenge and verifies the signature against it.
 *
 * The challenge is marked consumed *before* the signature is checked, inside a single
 * conditional UPDATE. Two concurrent requests carrying the same nonce therefore cannot
 * both succeed, which is what stops a captured signature from being replayed by a second
 * caller.
 */
export async function consumeWalletChallenge(input: {
  readonly nonce: string;
  readonly signature: string;
  readonly expectedPurpose: WalletChallengePurpose;
}): Promise<{ readonly address: string; readonly subject: string | null }> {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select()
    .from(walletChallenges)
    .where(eq(walletChallenges.nonce, input.nonce))
    .limit(1);

  const challenge: WalletChallengeRow | undefined = rows[0];
  if (!challenge) {
    throw new AppError("UNAUTHORIZED", "That wallet challenge is not valid.");
  }
  if (challenge.purpose !== input.expectedPurpose) {
    throw new AppError("UNAUTHORIZED", "That wallet challenge was issued for another action.");
  }
  if (challenge.consumedAt !== null) {
    throw new AppError("UNAUTHORIZED", "That wallet challenge has already been used.");
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("UNAUTHORIZED", "That wallet challenge has expired. Request a new one.");
  }

  // Claim the nonce atomically. `returning` yields nothing if another request won the race.
  const claimed = await db
    .update(walletChallenges)
    .set({ consumedAt: now })
    .where(and(eq(walletChallenges.id, challenge.id), isNull(walletChallenges.consumedAt)))
    .returning({ id: walletChallenges.id });

  if (claimed.length === 0) {
    throw new AppError("UNAUTHORIZED", "That wallet challenge has already been used.");
  }

  const valid = await verifyPersonalMessageSignature({
    message: challenge.message,
    signature: input.signature,
    address: challenge.address,
  });

  if (!valid) {
    getLogger().warn(
      { address: challenge.address, purpose: challenge.purpose },
      "wallet signature verification failed",
    );
    throw new AppError("UNAUTHORIZED", "The wallet signature does not match that challenge.");
  }

  return { address: challenge.address, subject: challenge.subject };
}
