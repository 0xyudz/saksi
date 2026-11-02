import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { readSessionUserId } from "@/lib/session";

/** API routes must fail with 401 instead of redirecting like page components do. */
export async function requireApiUserId(): Promise<string> {
  const userId = await readSessionUserId();
  if (!userId) {
    throw new AppError("UNAUTHORIZED", "Start a journal before making this request.");
  }
  return userId;
}

export async function optionalApiUserId(): Promise<string | undefined> {
  return readSessionUserId();
}

/**
 * Ingest spends the operator's paid provider quota and writes into the shared signal
 * catalogue, so it is restricted to handles listed in `OPERATOR_HANDLES`.
 *
 * Without this gate any visitor could create a journal in three seconds and then drive
 * unlimited provider calls. The check is deliberately a 403 rather than a 404: the caller
 * is authenticated, they simply are not an operator.
 */
export async function requireOperatorUserId(): Promise<string> {
  const userId = await requireApiUserId();
  const allowed = getEnv().OPERATOR_HANDLES;

  const rows = await getDb()
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const handle = rows[0]?.handle;
  if (!handle) {
    throw new AppError("UNAUTHORIZED", "Start a journal before making this request.");
  }

  if (!allowed.includes(handle.toLowerCase())) {
    throw new AppError("FORBIDDEN", "Ingesting provider signals is limited to operator journals.");
  }
  return userId;
}

/** True when the configured operator list is empty, i.e. ingestion is switched off. */
export function ingestionEnabled(): boolean {
  return getEnv().OPERATOR_HANDLES.length > 0;
}

/**
 * Server-rendered pages need the same rule as `requireOperatorUserId`, but without
 * throwing: a signed-out visitor or a normal journal simply does not see the ingest form
 * instead of being handed a button that always answers 401/403.
 */
export function isOperatorHandle(handle: string): boolean {
  return getEnv().OPERATOR_HANDLES.includes(handle.toLowerCase());
}
