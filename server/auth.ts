import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
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

export interface SellerIdentity {
  readonly userId: string;
  readonly handle: string;
  readonly walletAddress: string;
}

/**
 * Selling is open to anyone who can prove a wallet, not to a configured list of handles.
 *
 * The gate is a condition rather than a membership: a journal may list signals once it
 * has bound a wallet by signature, because that address is where buyers pay and a signal
 * cannot be priced without a destination. Requiring proof rather than an allowlist is
 * what makes the marketplace open without letting anyone list against someone else's
 * address.
 */
export async function requireSellerUserId(): Promise<SellerIdentity> {
  const userId = await requireApiUserId();

  const rows = await getDb()
    .select({
      handle: users.handle,
      walletAddress: users.walletAddress,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new AppError("UNAUTHORIZED", "Start a journal before making this request.");
  }
  if (row.walletAddress === null) {
    throw new AppError(
      "FORBIDDEN",
      "Bind a Sui wallet to this journal before listing signals: buyers pay the seller's wallet directly.",
    );
  }

  return { userId, handle: row.handle, walletAddress: row.walletAddress };
}

/** Server-rendered pages need the same rule without throwing. */
export function canSell(walletAddress: string | null): boolean {
  return walletAddress !== null;
}
