import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { picks, type PickRow } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { nowIso } from "@/lib/time";
import { verifyCommitment } from "@/server/scoring/commitment";

export const revealPickSchema = z.object({});

export interface RevealedPick {
  readonly pick: PickRow;
  readonly verified: boolean;
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

  if (pick.status === "resolved" || pick.status === "void") return { pick, verified };

  if (pick.revealAt && pick.revealAt.getTime() > Date.now()) {
    throw new AppError(
      "CONFLICT",
      `This commitment is time-locked until ${pick.revealAt.toISOString()}.`,
    );
  }

  const updated = await db
    .update(picks)
    .set({ status: "revealed", revealAt: pick.revealAt ?? new Date(nowIso()) })
    .where(eq(picks.id, pickId))
    .returning();

  const revealed = updated[0];
  if (!revealed) throw new AppError("INTERNAL", "Reveal could not be persisted.");
  return { pick: revealed, verified };
}
