import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users, type UserRow } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from "@/lib/recovery-code";
import { assertProofAddress, consumeWalletChallenge, normalizeAddress } from "@/server/wallet-auth";

export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, "use lowercase letters, numbers and underscores only");

export const createUserSchema = z.object({ handle: handleSchema });

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Claiming a handle now requires proof of wallet ownership: the address is part of the
 * journal's identity, it is where buyers' payments are sent, and it is unique across all
 * journals. Accepting it without a signature would let anyone register a wallet they do
 * not control and collect another seller's proceeds.
 */
export const claimJournalSchema = z.object({
  handle: handleSchema,
  address: z.string().trim().min(1).max(80),
  nonce: z.string().trim().min(1).max(80),
  signature: z.string().trim().min(1).max(400),
});

export type ClaimJournalInput = z.infer<typeof claimJournalSchema>;

export interface CreatedUser {
  readonly user: UserRow;
  /**
   * The plaintext recovery code. Returned exactly once, at creation, and never stored.
   * It is the only way back in if the wallet is lost, so the UI must show it prominently.
   */
  readonly recoveryCode: string;
}

/**
 * Creates a journal whose handle is bound to a proven wallet.
 *
 * The signature is verified first, so an unproven address never reaches the insert. Both
 * the handle and the address are unique in Postgres, so two simultaneous claims of the
 * same handle or the same wallet cannot both succeed; whichever loses reports a conflict.
 */
export async function claimJournal(input: ClaimJournalInput): Promise<CreatedUser> {
  const address = normalizeAddress(input.address);

  const proof = await consumeWalletChallenge({
    nonce: input.nonce,
    signature: input.signature,
    expectedPurpose: "claim",
  });

  if (proof.subject !== input.handle) {
    throw new AppError("UNAUTHORIZED", "That wallet proof was issued for a different handle.");
  }
  if (proof.address !== address) {
    throw new AppError("UNAUTHORIZED", "That wallet proof was issued for a different address.");
  }

  const recoveryCode = generateRecoveryCode();
  const recoveryHash = await hashRecoveryCode(recoveryCode);

  const inserted = await getDb()
    .insert(users)
    .values({
      handle: input.handle,
      recoveryHash,
      walletAddress: address,
      walletBoundAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  const user = inserted[0];
  if (!user) {
    throw new AppError(
      "CONFLICT",
      "That handle or wallet is already claimed. Sign in with the wallet that owns it.",
    );
  }
  return { user, recoveryCode };
}

export async function findUser(handle: string): Promise<UserRow | null> {
  const rows = await getDb().select().from(users).where(eq(users.handle, handle)).limit(1);
  return rows[0] ?? null;
}

export async function findUserByWallet(address: string): Promise<UserRow | null> {
  const rows = await getDb()
    .select()
    .from(users)
    .where(eq(users.walletAddress, normalizeAddress(address)))
    .limit(1);
  return rows[0] ?? null;
}

export const resumeSchema = z.object({
  handle: handleSchema,
  recoveryCode: z.string().trim().min(1).max(200),
});

export type ResumeInput = z.infer<typeof resumeSchema>;

/**
 * Resumes an existing journal with its handle and recovery code.
 *
 * Every failure returns the same `UNAUTHORIZED` error: telling a caller "that handle
 * exists but the code is wrong" would confirm which handles are real.
 *
 * The scrypt comparison runs even when the handle is unknown, so response time does not
 * reveal whether a handle exists either.
 */
export async function resumeUser(input: ResumeInput): Promise<UserRow> {
  const user = await findUser(input.handle);
  const matches = await verifyRecoveryCode(input.recoveryCode, user?.recoveryHash ?? null);

  if (!user || !matches) {
    throw new AppError(
      "UNAUTHORIZED",
      "That handle and recovery code do not match a resumable journal.",
    );
  }
  return user;
}

export const loginWithWalletSchema = z.object({
  address: z.string().trim().min(1).max(80),
  nonce: z.string().trim().min(1).max(80),
  signature: z.string().trim().min(1).max(400),
});

export type LoginWithWalletInput = z.infer<typeof loginWithWalletSchema>;

/**
 * Signs a returning seller back in by proving control of the wallet bound to their
 * journal. No handle is needed: the address already identifies exactly one journal,
 * because `users.wallet_address` is unique.
 */
export async function loginWithWallet(input: LoginWithWalletInput): Promise<UserRow> {
  const address = normalizeAddress(input.address);

  const proof = await consumeWalletChallenge({
    nonce: input.nonce,
    signature: input.signature,
    expectedPurpose: "login",
  });
  assertProofAddress(proof.address, address);

  const user = await findUserByWallet(proof.address);
  if (!user) {
    throw new AppError("NOT_FOUND", "No journal is bound to that wallet yet.");
  }
  return user;
}

export const bindWalletSchema = z.object({
  address: z.string().trim().min(1).max(80),
  nonce: z.string().trim().min(1).max(80),
  signature: z.string().trim().min(1).max(400),
});

export type BindWalletInput = z.infer<typeof bindWalletSchema>;

/**
 * Attaches a wallet to an existing journal that was created before wallet auth existed.
 *
 * This is the only path that changes `wallet_address` on an existing row, and it refuses
 * to steal an address that another journal already owns. Rebinding a journal that already
 * has a wallet is rejected on purpose: silently repointing where buyers pay would let a
 * hijacked session redirect a seller's income.
 */
export async function bindWalletToUser(userId: string, input: BindWalletInput): Promise<UserRow> {
  const address = normalizeAddress(input.address);

  const proof = await consumeWalletChallenge({
    nonce: input.nonce,
    signature: input.signature,
    expectedPurpose: "bind",
  });
  assertProofAddress(proof.address, address);

  const updated = await getDb()
    .update(users)
    .set({ walletAddress: proof.address, walletBoundAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.walletAddress)))
    .returning();

  const user = updated[0];
  if (user) return user;

  const existing = await getDb()
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing.length === 0) {
    throw new AppError("NOT_FOUND", "That journal no longer exists.");
  }
  if (existing[0]?.walletAddress !== null) {
    throw new AppError("CONFLICT", "This journal already has a wallet bound to it.");
  }

  // The update matched nothing for a reason other than an existing binding: the address
  // must belong to another journal.
  throw new AppError("CONFLICT", "That wallet is already bound to a different journal.");
}

/** True when any journal has claimed this address, used to explain conflicts in the UI. */
export async function walletIsClaimed(address: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.walletAddress, normalizeAddress(address)))
    .limit(1);
  return rows.length > 0;
}

/** Number of journals, used by the health endpoint and tests. */
export async function countUsers(): Promise<number> {
  const rows = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(users);
  return rows[0]?.total ?? 0;
}
