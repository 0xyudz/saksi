/**
 * Client-safe half of the recovery-code format. This module must not import `node:crypto`,
 * because the onboarding form renders the code in the browser. Hashing and verification
 * live in `lib/recovery-code.ts`, which re-exports these helpers.
 */

/** 32 symbols, excluding I, O, 0 and 1 so a code can be read aloud without ambiguity. */
export const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const GROUP_SIZE = 4;

export const RECOVERY_GROUPS = 6;
export const RECOVERY_CODE_LENGTH = RECOVERY_GROUPS * GROUP_SIZE;

/**
 * Uppercase and drop anything that is not a symbol in the alphabet, so a code still
 * verifies when it is pasted with dashes, spaces or the wrong case.
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter((character) => RECOVERY_ALPHABET.includes(character))
    .join("");
}

/** Groups the code for display: `ABCD-EFGH-...`. Presentation only. */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += GROUP_SIZE) {
    groups.push(code.slice(index, index + GROUP_SIZE));
  }
  return groups.join("-");
}
