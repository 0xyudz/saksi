import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users, type UserRow } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from "@/lib/recovery-code";

export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, "use lowercase letters, numbers and underscores only");

export const createUserSchema = z.object({ handle: handleSchema });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export interface CreatedUser {
  readonly user: UserRow;
  /**
   * The plaintext recovery code. Returned exactly once, at creation, and never stored.
   * Losing it means the journal cannot be resumed after logout.
   */
  readonly recoveryCode: string;
}

export async function createUser(input: CreateUserInput): Promise<CreatedUser> {
  const recoveryCode = generateRecoveryCode();
  const recoveryHash = await hashRecoveryCode(recoveryCode);

  const inserted = await getDb()
    .insert(users)
    .values({ handle: input.handle, recoveryHash })
    .onConflictDoNothing({ target: users.handle })
    .returning();

  const user = inserted[0];
  if (!user) {
    throw new AppError(
      "CONFLICT",
      "That handle is already claimed. Use your recovery code to resume it instead.",
    );
  }
  return { user, recoveryCode };
}

export async function findUser(handle: string): Promise<UserRow | null> {
  const rows = await getDb().select().from(users).where(eq(users.handle, handle)).limit(1);
  return rows[0] ?? null;
}

export const resumeSchema = z.object({
  handle: handleSchema,
  recoveryCode: z.string().trim().min(1).max(200),
});

export type ResumeInput = z.infer<typeof resumeSchema>;

/**
 * Resumes an existing journal. Every failure returns the same `UNAUTHORIZED` error: telling
 * a caller "that handle exists but the code is wrong" would confirm which handles are real.
 *
 * The scrypt comparison runs even when the handle is unknown, so response time does not
 * reveal whether a handle exists either.
 */
export async function resumeUser(input: ResumeInput): Promise<UserRow> {
  const user = await findUser(input.handle);
  const matches = await verifyRecoveryCode(input.recoveryCode, user?.recoveryHash ?? null);

  if (!user || !matches) {
    throw new AppError(
      "UNAUTHORIZED",
      "That handle and recovery code do not match a resumable journal.",
    );
  }
  return user;
}
