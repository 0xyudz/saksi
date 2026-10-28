/**
 * Sui coin types are case-insensitive and their address components may omit leading
 * zeroes (`0x2` vs the full 32-byte form). Compare a single canonical representation.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]+$/;

function normalizeAddress(value: string): string {
  const hex = value.slice(2).toLowerCase().replace(/^0+/, "");
  return `0x${hex.padStart(64, "0")}`;
}

export function normalizeCoinType(value: string): string {
  return value
    .trim()
    .split("::")
    .map((part) => (ADDRESS_PATTERN.test(part) ? normalizeAddress(part) : part.toLowerCase()))
    .join("::");
}
