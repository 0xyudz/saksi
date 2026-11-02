import { z } from "zod";

/**
 * Route params arrive as untrusted strings. Every detail page queries Postgres with them,
 * and Postgres rejects a non-UUID with a type error, which surfaces as a 500 instead of
 * "not found". Pages validate the shape first so a malformed or stale link renders the
 * not-found UI.
 */
const uuidSchema = z.string().uuid();

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}
