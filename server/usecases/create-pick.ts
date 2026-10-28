import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { analysts, picks, type PickRow } from "@/db/schema";
import { remember } from "@/integrations/walrus-memory/client";
import { buildPickCommitMemory } from "@/integrations/walrus-memory/schema";
import { AppError } from "@/lib/errors";
import { errorForLog, getLogger } from "@/lib/logger";
import { nowIso } from "@/lib/time";
import { buildPickPayload, hashPickPayload } from "@/server/scoring/commitment";

export const createPickSchema = z.object({
  analystId: z.string().uuid(),
  eventRef: z.string().trim().min(2).max(200),
  market: z.string().trim().min(2).max(200),
  selection: z.string().trim().min(1).max(200),
  odds: z.number().gt(1).max(1000),
  stakeUnits: z.number().int().min(1).max(1_000_000),
  revealAt: z.string().datetime({ offset: true }).optional(),
});

export type CreatePickInput = z.infer<typeof createPickSchema>;

export interface CreatedPick {
  readonly pick: PickRow;
  readonly commitmentHash: string;
  readonly blobId: string;
  readonly jobId: string;
  readonly namespace: string;
}

export async function createPick(userId: string, input: CreatePickInput): Promise<CreatedPick> {
  const db = getDb();
  const analystRows = await db
    .select({ id: analysts.id })
    .from(analysts)
    .where(eq(analysts.id, input.analystId))
    .limit(1);

  if (analystRows.length === 0) {
    throw new AppError("NOT_FOUND", "The selected analyst does not exist.");
  }

  const committedAt = nowIso();
  if (
    input.revealAt !== undefined &&
    new Date(input.revealAt).getTime() <= new Date(committedAt).getTime()
  ) {
    throw new AppError("VALIDATION_FAILED", "The reveal time must be after the commitment.");
  }

  const payload = buildPickPayload({
    userId,
    analystId: input.analystId,
    eventRef: input.eventRef,
    market: input.market,
    selection: input.selection,
    odds: input.odds,
    stakeUnits: input.stakeUnits,
    committedAt,
  });
  const commitmentHash = hashPickPayload(payload);

  const inserted = await db
    .insert(picks)
    .values({
      userId,
      analystId: input.analystId,
      eventRef: payload.eventRef,
      market: payload.market,
      selection: payload.selection,
      odds: payload.odds,
      stakeUnits: payload.stakeUnits,
      commitmentHash,
      pickPayload: payload,
      committedAt: new Date(committedAt),
      ...(input.revealAt === undefined ? {} : { revealAt: new Date(input.revealAt) }),
      status: "sealed",
    })
    .returning();

  const pick = inserted[0];
  if (!pick) {
    throw new AppError("INTERNAL", "The pick could not be persisted.");
  }

  const memory = buildPickCommitMemory({
    id: pick.id,
    analyst: pick.analystId,
    market: pick.market,
    commitmentHash,
    committedAt,
  });

  try {
    const write = await remember(userId, memory);
    return {
      pick,
      commitmentHash,
      blobId: write.blobId,
      jobId: write.jobId,
      namespace: write.namespace,
    };
  } catch (error) {
    // No memory, no sealed pick: remove the row so the journal never claims a write
    // that Walrus did not accept.
    await db.delete(picks).where(eq(picks.id, pick.id));
    getLogger().error(
      { error: errorForLog(error), pickId: pick.id },
      "sealed pick rolled back because the memory write failed",
    );
    throw new AppError("UPSTREAM_UNAVAILABLE", "Walrus Memory did not accept the sealed pick.", {
      cause: error,
    });
  }
}
