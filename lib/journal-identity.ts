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
