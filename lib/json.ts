import type { JsonObject, JsonValue } from "@/lib/domain";

/** Converts unknown runtime data into JSON-safe values without `any` escapes. */
export function toJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 20) throw new Error("JSON value is nested too deeply");

  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON does not allow non-finite numbers");
    return value;
  }

  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, depth + 1));

  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      result[key] = toJsonValue(item, depth + 1);
    }
    return result;
  }

  throw new Error(`JSON does not allow ${typeof value} values`);
}

export function toJsonObject(value: unknown): JsonObject {
  const converted = toJsonValue(value);
  if (converted === null || Array.isArray(converted) || typeof converted !== "object") {
    throw new Error("Expected a JSON object");
  }
  return converted;
}
