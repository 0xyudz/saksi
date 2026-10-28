/** Time helpers keep ISO-8601 handling in one place so payload hashes stay stable. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isPast(iso: string, reference: Date = new Date()): boolean {
  return new Date(iso).getTime() <= reference.getTime();
}

export function daysBetween(earlier: Date | string, later: Date | string): number {
  const start = new Date(earlier).getTime();
  const end = new Date(later).getTime();
  return Math.abs(end - start) / 86_400_000;
}
