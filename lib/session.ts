import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { SESSION_COOKIE } from "./config";
import { getEnv } from "./env";
import { getLogger } from "./logger";
import { verifySession } from "./session-cookie";

export interface SessionUser {
  readonly id: string;
  readonly handle: string;
  /**
   * False for journals created before recovery codes existed. Those can never be resumed,
   * so the UI must warn about that instead of pointing at a code that does not exist.
   */
  readonly hasRecovery: boolean;
}

export async function readSessionUserId(): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) return undefined;

  const userId = verifySession(value, getEnv().SESSION_SECRET);
  if (!userId) {
    getLogger().warn("session cookie signature is invalid");
    return undefined;
  }
  return userId;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const id = await readSessionUserId();
  if (!id) return null;

  const db = getDb();
  const rows = await db
    .select({ id: users.id, handle: users.handle, recoveryHash: users.recoveryHash })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    getLogger().warn({ userId: id }, "session cookie points at a missing user");
    return null;
  }
  return { id: row.id, handle: row.handle, hasRecovery: row.recoveryHash !== null };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/onboarding");
  return user;
}
