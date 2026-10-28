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
