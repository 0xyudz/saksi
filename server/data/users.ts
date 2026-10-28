import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users, type UserRow } from "@/db/schema";
import { AppError } from "@/lib/errors";

export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, "use lowercase letters, numbers and underscores only");

export const createUserSchema = z.object({ handle: handleSchema });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const inserted = await getDb()
    .insert(users)
    .values({ handle: input.handle })
    .onConflictDoNothing({ target: users.handle })
    .returning();

  const user = inserted[0];
  if (!user) {
    throw new AppError("CONFLICT", "That handle is already claimed.");
  }
  return user;
}

export async function findUser(handle: string): Promise<UserRow | null> {
  const rows = await getDb().select().from(users).where(eq(users.handle, handle)).limit(1);
  return rows[0] ?? null;
}
