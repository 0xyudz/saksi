import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readJournalRecord } from "@/integrations/walrus-memory/client";
import { SESSION_COOKIE } from "./config";
import { getEnv } from "./env";
import { getLogger } from "./logger";
import { signSession, verifySession } from "./session-cookie";

/** One year: a journal is meant to be long-lived, and the wallet can always re-prove it. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Issues the signed session cookie. Shared by every sign-in path (wallet claim, wallet
 * login, recovery code) so the cookie's attributes cannot drift between them.
 */
export async function startSession(ref: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: signSession(ref, getEnv().SESSION_SECRET),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export interface SessionUser {
  /**
   * The journal's identity: a Sui address, or a uuid for journals created before identity
   * moved to the wallet. This is what every query keys on.
   */
  readonly id: string;
  readonly handle: string;
  /**
   * False for journals created before recovery codes existed. Those can never be resumed,
   * so the UI must warn about that instead of pointing at a code that does not exist.
   */
  readonly hasRecovery: boolean;
  /**
   * The proven wallet. Never null: a session only exists because a wallet signed for it, so
   * there is no such thing as a signed-in journal without an address.
   */
  readonly walletAddress: string;
}

export async function readSessionUserId(): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) return undefined;

  const ref = verifySession(value, getEnv().SESSION_SECRET);
  if (!ref) {
    getLogger().warn("session cookie signature is invalid");
    return undefined;
  }
  return ref;
}

/**
 * Resolves the session without reading a database.
 *
 * The cookie is a signed ref, and the ref is the identity, so the only thing still needed is
 * the display handle — which lives in the journal's own wallet-keyed memory. A missing
 * record means the cookie names a wallet with no journal, and that is a signed-out state.
 *
 * `hasRecovery` is reported as true because a journal created by this code always wrote a
 * recovery pointer. Legacy journals that never had one cannot sign in any more: their ref
 * was a uuid and nothing maps a wallet to it, which is why the recovery path exists.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const ref = await readSessionUserId();
  if (!ref) return null;

  const record = await readJournalRecord(ref);
  if (record === null) {
    getLogger().warn({ ref }, "session cookie names a journal with no identity record");
    return null;
  }

  return {
    id: record.ref,
    handle: record.handle,
    hasRecovery: true,
    walletAddress: record.wallet,
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/onboarding");
  return user;
}
