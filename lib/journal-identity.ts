import { createHash } from "node:crypto";

/**
 * A journal is identified by the wallet that proved ownership of it.
 *
 * This replaces the `users` row as the identity. The handle survives only as a display
 * name: two journals may share one, because nothing about authorisation depends on it any
 * more. What must be unique — and what Walrus cannot enforce — is the wallet, and the
 * wallet is self-certifying: you are that journal only if you can sign for that address.
 *
 * `JournalRef` is therefore an opaque string that is *either* a lowercase Sui address (new
 * journals) or a uuid (journals created before this change). Keeping the old form readable
 * is what lets existing memories stay in `saksi:<uuid>` instead of being copied forward.
 */

const SUI_ADDRESS_PATTERN = /^0x[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type JournalRef = string;

/** True for the canonical 32-byte Sui address form. */
export function isWalletRef(ref: string): boolean {
  return SUI_ADDRESS_PATTERN.test(ref);
}

/** True for the pre-migration uuid form, still readable. */
export function isLegacyRef(ref: string): boolean {
  return UUID_PATTERN.test(ref);
}

export function isJournalRef(ref: string): boolean {
  return isWalletRef(ref) || isLegacyRef(ref);
}

/**
 * Normalises an address to the form used as a ref.
 *
 * Sui accepts short forms (`0x2`, `0xabc`), so an un-normalised address would produce two
 * different namespace names for the same wallet. Left-padding to 64 hex characters is the
 * canonical form, and lowercasing removes the checksum case difference.
 */
export function normalizeWalletRef(address: string): JournalRef {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error("A Sui address must start with 0x");
  }
  const body = trimmed.slice(2);
  if (!/^[0-9a-f]{1,64}$/.test(body)) {
    throw new Error("A Sui address must be 1 to 64 hex characters after 0x");
  }
  return `0x${body.padStart(64, "0")}`;
}

/**
 * A handle is a display name. It is validated for shape, never for uniqueness.
 *
 * The same shape rules as before are kept so the UI, the URL form and existing handles all
 * still make sense.
 */
export function isHandleShaped(handle: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(handle);
}

/**
 * Recovery lookup key.
 *
 * The recovery code is 24 symbols from a 32-character alphabet, so it carries 120 bits of
 * entropy. Hashing it with SHA-256 and using the digest as a namespace name is safe to
 * publish: an attacker cannot enumerate 2^120 inputs, so the digest reveals nothing. This
 * is what allows recovery to work without a table — the code *is* the key.
 *
 * The digest is truncated to 32 hex characters only because it appears in a namespace name
 * and a full 64 is needless width; 128 bits remains far beyond reach.
 */
export function recoveryLookupKey(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex").slice(0, 32);
}

/** The namespace that maps a recovery code digest to the journal it unlocks. */
export function recoveryNamespace(prefix: string, code: string): string {
  return `${prefix}:recovery:${recoveryLookupKey(code)}`;
}

/**
 * The namespace holding a journal's identity record, keyed by wallet.
 *
 * This is a separate namespace from the journal's data on purpose. A journal's memories live
 * in `saksi:<ref>`, and for journals created before identity moved to the wallet that ref is
 * a uuid which cannot be rewritten — Walrus is append-only. Keying identity by wallet gives
 * an exact lookup (`login` needs wallet → journal) without touching the existing data.
 */
export function walletNamespace(prefix: string, wallet: string): string {
  return `${prefix}:wallet:${wallet}`;
}

/** The fields of an identity record that this selector needs. */
export interface JournalRecordLike {
  readonly ref: string;
  readonly createdAt: string;
}

/**
 * How many candidates an identity lookup must recall to be able to see the oldest record.
 *
 * `recall()` is a similarity search: the relayer selects the cosine top-`limit` and only then
 * orders the result, so a record outside that window cannot be recovered by any later step.
 * Picking the oldest of a fixed 20-candidate window would therefore be "oldest of the twenty
 * most similar", which is a different and wrong answer once a namespace holds more records.
 *
 * The window is derived from the exact record count instead, with a floor of 20 for margin
 * against a briefly stale index, and capped at 100 because the relayer refuses more.
 */
export const IDENTITY_RECALL_FLOOR = 20;
export const IDENTITY_RECALL_CAP = 100;

export function identityRecallWindow(recordCount: number): number {
  return Math.min(Math.max(recordCount, IDENTITY_RECALL_FLOOR), IDENTITY_RECALL_CAP);
}

/** True when the record count exceeds what one recall can see, so "oldest" is unprovable. */
export function identityWindowComplete(recordCount: number): boolean {
  return recordCount <= IDENTITY_RECALL_CAP;
}

/**
 * Picks the identity record that a wallet should resolve to.
 *
 * A wallet is supposed to have exactly one, and `claimJournal` now refuses a second claim so
 * that stays true. It did not always hold: a wallet could be claimed twice, leaving two
 * records that point at different refs. Because the ref decides the namespace, resolving to
 * whichever the relayer happened to rank first would move the journal between namespaces
 * between requests.
 *
 * The oldest record wins. A journal's identity was established at its first claim, and every
 * later record is a duplicate. `createdAt` is ISO-8601, so comparing it as a string is
 * chronological.
 *
 * This selector is only correct over the *complete* set of records; the caller is responsible
 * for widening the recall window to the real count (see `identityRecallWindow`).
 *
 * Kept pure and separate from the relayer so the ordering rule is unit tested.
 */
export function oldestJournalRecord<T extends JournalRecordLike>(
  records: ReadonlyArray<T>,
): T | null {
  let oldest: T | null = null;
  for (const record of records) {
    if (oldest === null || record.createdAt.localeCompare(oldest.createdAt) < 0) {
      oldest = record;
    }
  }
  return oldest;
}
