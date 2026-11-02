import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { normalizeRecoveryCode, RECOVERY_ALPHABET, RECOVERY_CODE_LENGTH } from "./recovery-format";

export {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_ALPHABET,
  RECOVERY_CODE_LENGTH,
} from "./recovery-format";

/**
 * `promisify` collapses scrypt's overload set and drops the options argument, so the
 * signature is restated here rather than cast at every call site.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { readonly N: number; readonly r: number; readonly p: number },
) => Promise<Buffer>;

/**
 * A journal has no password and no email, so the only thing that can prove ownership of a
 * handle is a secret handed out exactly once at creation. This module owns that secret.
 *
 * The code is stored only as a scrypt hash: a database leak must not let an attacker take
 * over journals. Verification is constant-time on the derived key.
 */

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 } as const;

const STORED_PATTERN = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/;

/**
 * Used when there is no stored hash. Verification still runs a full scrypt derivation
 * against this value, so an unknown handle and a known handle with a wrong code take the
 * same time. Without it, response latency would reveal which handles exist.
 */
const ABSENT_HASH = `scrypt$${"00".repeat(SALT_BYTES)}$${"00".repeat(KEY_BYTES)}`;

/**
 * 120 bits of entropy. `randomBytes` is rejection-sampled instead of reduced with
 * `% alphabet.length`, so the mapping stays unbiased if the alphabet is ever changed to a
 * length that does not divide 256.
 */
export function generateRecoveryCode(): string {
  const characters: string[] = [];
  const limit = 256 - (256 % RECOVERY_ALPHABET.length);

  while (characters.length < RECOVERY_CODE_LENGTH) {
    for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) {
      if (byte >= limit) continue;
      characters.push(RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length] as string);
      if (characters.length === RECOVERY_CODE_LENGTH) break;
    }
  }

  return characters.join("");
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_LENGTH) {
    throw new Error(`A recovery code must contain ${RECOVERY_CODE_LENGTH} symbols`);
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(normalized, salt, KEY_BYTES, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Returns false for a null/absent hash and for a malformed stored value, so a journal
 * created before recovery existed can never be resumed by guessing.
 *
 * A missing hash is not a fast path: the derivation runs against `ABSENT_HASH` so the
 * caller's latency does not distinguish "no such journal" from "wrong code".
 */
export async function verifyRecoveryCode(code: string, stored: string | null): Promise<boolean> {
  const target = stored ?? ABSENT_HASH;

  const match = STORED_PATTERN.exec(target);
  if (!match) return false;

  const saltHex = match[1];
  const expectedHex = match[2];
  if (saltHex === undefined || expectedHex === undefined) return false;

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_LENGTH) return false;

  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== KEY_BYTES) return false;

  const derived = await scrypt(normalized, Buffer.from(saltHex, "hex"), KEY_BYTES, SCRYPT_OPTIONS);

  if (derived.length !== expected.length) return false;
  // `stored === null` can never match, because the derived key would have to be all zeroes.
  return timingSafeEqual(derived, expected) && stored !== null;
}
