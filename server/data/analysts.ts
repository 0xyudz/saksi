import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { analysts, type AnalystRow } from "@/db/schema";
import { AppError } from "@/lib/errors";

export const createAnalystSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["human", "agent", "source"]),
  externalRef: z.string().trim().min(1).max(200).optional(),
});

export type CreateAnalystInput = z.infer<typeof createAnalystSchema>;

export async function createAnalyst(input: CreateAnalystInput): Promise<AnalystRow> {
  const inserted = await getDb()
    .insert(analysts)
    .values({
      name: input.name,
      kind: input.kind,
      externalRef: input.externalRef ?? null,
    })
    .onConflictDoNothing({ target: [analysts.name, analysts.kind] })
    .returning();

  const analyst = inserted[0];
  if (!analyst) {
    throw new AppError("CONFLICT", "An analyst with that name and kind already exists.");
  }
  return analyst;
}

export async function listAnalysts(): Promise<AnalystRow[]> {
  return getDb().select().from(analysts).orderBy(asc(analysts.name));
}

export async function findAnalystByName(
  name: string,
  kind: AnalystRow["kind"],
): Promise<AnalystRow | null> {
  const rows = await getDb().select().from(analysts).where(eq(analysts.name, name)).limit(5);
  return rows.find((row) => row.kind === kind) ?? null;
}
