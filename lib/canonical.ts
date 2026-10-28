import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted lexicographically, no insignificant whitespace,
 * UTF-8 output. Values are validated at runtime so two callers can never disagree
 * about the bytes being hashed.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON does not allow non-finite numbers");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error("Canonical JSON only accepts plain objects");
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }

  throw new Error(`Canonical JSON does not allow ${typeof value} values`);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function commitmentHash(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}
