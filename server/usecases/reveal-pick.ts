import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { picks, type PickRow } from "@/db/schema";
import { remember } from "@/integrations/walrus-memory/client";
import { buildPickRevealMemory } from "@/integrations/walrus-memory/schema";
import { AppError } from "@/lib/errors";
import { errorForLog, getLogger } from "@/lib/logger";
import { nowIso } from "@/lib/time";
import { verifyCommitment } from "@/server/scoring/commitment";

export const revealPickSchema = z.object({});

export interface RevealedPick {
  readonly pick: PickRow;
  readonly verified: boolean;
  readonly revealMemoryBlobId: string | null;
}

export async function revealPick(userId: string, pickId: string): Promise<RevealedPick> {
  const db = getDb();
  const rows = await db.select().from(picks).where(eq(picks.id, pickId)).limit(1);
  const pick = rows[0];

  if (!pick) throw new AppError("NOT_FOUND", "Pick not found.");
  if (pick.userId !== userId) {
    throw new AppError("FORBIDDEN", "Only the owner of a pick can reveal it.");
  }

  const verified = verifyCommitment(pick.pickPayload, pick.commitmentHash);
  if (!verified) {
    throw new AppError(
      "CONFLICT",
      "The stored reveal does not match the commitment hash. Reveal refused.",
    );
  }

  if (pick.status === "resolved" || pick.status === "void") {
    return { pick, verified, revealMemoryBlobId: null };
  }
  if (pick.status !== "sealed") {
    return { pick, verified, revealMemoryBlobId: null };
  }

  if (pick.revealAt && pick.revealAt.getTime() > Date.now()) {
    throw new AppError(
      "CONFLICT",
      `This commitment is time-locked until ${pick.revealAt.toISOString()}.`,
    );
  }

  const revealedAt = pick.revealAt ?? new Date(nowIso());
  const updated = await db
    .update(picks)
    .set({ status: "revealed", revealAt: revealedAt })
    .where(eq(picks.id, pickId))
    .returning();

  const revealed = updated[0];
  if (!revealed) throw new AppError("INTERNAL", "Reveal could not be persisted.");

  // The reveal memory is additional evidence, not the source of the reveal itself.
  // If Walrus is unavailable the on-chain commitment and the database status remain
  // authoritative, so this write never rolls the reveal back.
  let revealMemoryBlobId: string | null = null;
  try {
    const write = await remember(
      userId,
      buildPickRevealMemory({
        id: revealed.id,
        selection: revealed.selection,
        odds: revealed.odds,
        revealedAt: revealedAt.toISOString(),
      }),
    );
    revealMemoryBlobId = write.blobId;
  } catch (error) {
    getLogger().warn(
      { error: errorForLog(error), pickId },
      "reveal memory could not be written; reveal remains valid",
    );
  }

  return { pick: revealed, verified, revealMemoryBlobId };
}
