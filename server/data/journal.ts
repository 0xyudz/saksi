import { z } from "zod";

import {
  recall,
  readJournalRecord,
  readRecoveryPointer,
  rememberJournal,
  rememberRecovery,
} from "@/integrations/walrus-memory/client";
import { generateRecoveryCode } from "@/lib/recovery-code";
import { AppError } from "@/lib/errors";
import { isWalletRef, normalizeWalletRef, type JournalRef } from "@/lib/journal-identity";
import { assertProofAddress, consumeWalletChallenge } from "@/server/wallet-auth";

/**
 * Journal identity, without a table.
 *
 * A journal *is* a wallet: the ref is the address, and ownership is proven by signing with
 * it. Nothing is registered, so there is no row to look up and nothing to keep in sync.
 *
 * What the deleted `users` table used to provide and this module has to reproduce honestly:
 *
 * - **Wallet uniqueness** — free, because the wallet is the key. Two journals cannot share
 *   an address without sharing a private key.
 * - **Handle uniqueness** — given up on purpose. A handle is a display name now. Walrus has
 *   no unique constraint, and a check-then-write against `listNamespaces()` is not atomic:
 *   two people claiming one name would both see it free and both write into the *same*
 *   namespace, corrupting a journal. Since a handle no longer authorises anything, sharing
 *   one is cosmetic, whereas a race that merges two journals is not.
 * - **Recovery lookup** — preserved, and made exact-key. The code has 120 bits of entropy,
 *   so `saksi:recovery:<sha256(code)>` is a namespace whose *name* is the secret. Anyone
 *   can read it and learn only the address it unlocks; nobody can enumerate the code.
 */

/**
 * Reads a journal's handle.
 *
 * A wallet ref resolves through the wallet-keyed identity namespace. A legacy uuid ref has
 * no such record — it predates wallet identity — so it falls back to a `journal` memory in
 * the journal's own namespace, which is where the backfill wrote it. Both paths are relayer
 * reads; neither touches a table.
 */
export async function readJournalHandle(ref: string): Promise<string | null> {
  if (isWalletRef(ref)) {
    const record = await readJournalRecord(ref);
    if (record !== null) return record.handle;
  }

  const { hits } = await recall(ref, "journal identity handle", 20);
  for (const hit of hits) {
    if (hit.memory?.kind === "journal") return hit.memory.handle;
  }
  return null;
}

/**
 * Reads several handles at once.
 *
 * One relayer call per distinct ref, run concurrently. A failure for one journal yields
 * null for that journal rather than failing the page: a display name is not worth an error
 * page, and the address is always available as a fallback label.
 */
export async function readJournalHandles(
  refs: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> {
  const distinct = [...new Set(refs)];
  const entries = await Promise.all(
    distinct.map(async (ref) => {
      try {
        return [ref, await readJournalHandle(ref)] as const;
      } catch {
        return [ref, null] as const;
      }
    }),
  );

  const handles = new Map<string, string>();
  for (const [ref, handle] of entries) {
    if (handle !== null) handles.set(ref, handle);
  }
  return handles;
}

/** A short label for a journal whose handle is unknown: the address, truncated. */
export function labelForRef(ref: string, handles: ReadonlyMap<string, string>): string {
  return handles.get(ref) ?? `${ref.slice(0, 6)}…${ref.slice(-4)}`;
}

/**
 * The display label for one journal, falling back to a truncated address.
 *
 * A display name is never worth an error page, so an unreadable record degrades to the
 * address the reader can already see on chain.
 */
export async function labelForOne(ref: string): Promise<string> {
  const handle = await readJournalHandle(ref).catch(() => null);
  return handle ?? `${ref.slice(0, 6)}…${ref.slice(-4)}`;
}

export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, "use lowercase letters, numbers and underscores only");

export const claimJournalSchema = z.object({
  handle: handleSchema,
  address: z.string().trim().min(1).max(80),
  nonce: z.string().trim().min(1).max(80),
  signature: z.string().trim().min(1).max(400),
});

export type ClaimJournalInput = z.infer<typeof claimJournalSchema>;

export interface Journal {
  readonly ref: JournalRef;
  readonly handle: string;
  /** The address that can sign for this journal. Always present. */
  readonly walletAddress: string;
}

export interface CreatedJournal {
  readonly journal: Journal;
  /** Returned exactly once, at creation, and never stored in plaintext anywhere. */
  readonly recoveryCode: string;
  /** Blob ids of the identity and recovery records, as receipts. */
  readonly receipts: { readonly journal: string; readonly recovery: string };
}

/**
 * Creates a journal for a proven wallet.
 *
 * The signature is verified before anything is written, so an unproven address never
 * reaches the relayer. There is no insert and therefore no conflict to report: claiming a
 * handle twice is allowed, and claiming an address twice is impossible.
 */
export async function claimJournal(input: ClaimJournalInput): Promise<CreatedJournal> {
  const wallet = normalizeWalletRef(input.address);

  const proof = await consumeWalletChallenge({
    nonce: input.nonce,
    signature: input.signature,
    expectedPurpose: "claim",
  });

  if (proof.subject !== input.handle) {
    throw new AppError("UNAUTHORIZED", "That wallet proof was issued for a different handle.");
  }
  assertProofAddress(proof.address, wallet);

  const createdAt = new Date().toISOString();
  const recoveryCode = generateRecoveryCode();

  const journalRecord = await rememberJournal({
    ref: wallet,
    wallet,
    handle: input.handle,
    createdAt,
  });
  const recoveryRecord = await rememberRecovery({
    code: recoveryCode,
    ref: wallet,
    wallet,
    handle: input.handle,
    createdAt,
  });

  return {
    journal: { ref: wallet, handle: input.handle, walletAddress: wallet },
    recoveryCode,
    receipts: { journal: journalRecord.blobId, recovery: recoveryRecord.blobId },
  };
}

export const loginWithWalletSchema = z.object({
  address: z.string().trim().min(1).max(80),
  nonce: z.string().trim().min(1).max(80),
  signature: z.string().trim().min(1).max(400),
});

export type LoginWithWalletInput = z.infer<typeof loginWithWalletSchema>;

/**
 * Signs a returning journal in by proving control of its wallet.
 *
 * No lookup happens at all: the address in the proof *is* the ref. The handle is read back
 * from the journal's own memory so the UI can greet it, but a missing or unreadable handle
 * is not a failed login — the wallet already proved who this is.
 */
export async function loginWithWallet(input: LoginWithWalletInput): Promise<Journal> {
  const wallet = normalizeWalletRef(input.address);

  const proof = await consumeWalletChallenge({
    nonce: input.nonce,
    signature: input.signature,
    expectedPurpose: "login",
  });
  assertProofAddress(proof.address, wallet);

  const record = await readJournalRecord(wallet);
  if (record === null) {
    throw new AppError("NOT_FOUND", "That wallet has no journal yet. Claim a handle to start one.");
  }
  return { ref: record.ref, handle: record.handle, walletAddress: record.wallet };
}

export const resumeSchema = z.object({
  recoveryCode: z.string().trim().min(1).max(200),
});

export type ResumeInput = z.infer<typeof resumeSchema>;

/**
 * Resumes a journal from its recovery code alone.
 *
 * The code is the key: its digest names a namespace, and the relayer's exact-key lookup
 * returns the journal. The handle is not needed and is not checked, because a handle is not
 * unique and therefore cannot select a journal.
 *
 * Every failure returns the same error. Distinguishing "no such code" from "malformed code"
 * would tell a caller which codes exist.
 */
export async function resumeJournal(input: ResumeInput): Promise<Journal> {
  const pointer = await readRecoveryPointer(input.recoveryCode);
  if (pointer === null) {
    throw new AppError("UNAUTHORIZED", "That recovery code does not unlock a journal.");
  }

  return { ref: pointer.ref, handle: pointer.handle, walletAddress: pointer.wallet };
}
