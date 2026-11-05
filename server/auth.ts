import { AppError } from "@/lib/errors";
import { readSessionUserId } from "@/lib/session";
import { isJournalRef } from "@/lib/journal-identity";

/** API routes must fail with 401 instead of redirecting like page components do. */
export async function requireApiUserId(): Promise<string> {
  const ref = await readSessionUserId();
  if (!ref) {
    throw new AppError("UNAUTHORIZED", "Start a journal before making this request.");
  }
  if (!isJournalRef(ref)) {
    throw new AppError("UNAUTHORIZED", "That session does not name a journal.");
  }
  return ref;
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
 * There is nothing to look up: the session ref *is* the proven address, because a journal
 * only ever comes into existence through a signed claim. The old version read
 * `users.wallet_address` to check for a binding; that check is now structural — a session
 * that exists at all was issued after a signature over that address.
 *
 * The handle is read from memory because it is a display name, and a display name that
 * cannot be read is not a reason to refuse a sale.
 */
export async function requireSellerUserId(): Promise<SellerIdentity> {
  const ref = await requireApiUserId();

  if (!ref.startsWith("0x")) {
    throw new AppError(
      "FORBIDDEN",
      "This journal predates wallet identity and cannot list signals. Claim a new journal with a wallet to sell.",
    );
  }

  return { userId: ref, handle: ref, walletAddress: ref };
}
