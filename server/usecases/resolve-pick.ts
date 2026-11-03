import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { outcomes, picks, type OutcomeRow, type PickRow } from "@/db/schema";
import { remember } from "@/integrations/walrus-memory/client";
import {
  buildBiasMemory,
  buildOutcomeMemory,
  buildSourceRoiMemory,
} from "@/integrations/walrus-memory/schema";
import { parseOracleRef, parseSelection, readFixtureResult } from "@/integrations/oracle/results";
import { UNDERDOG_ODDS_THRESHOLD } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { errorForLog, getLogger } from "@/lib/logger";
import { nowIso } from "@/lib/time";
import { loadAnalystSamples } from "@/server/data/picks";
import { providersForPick, sourceRoi } from "@/server/data/payments";
import { detectBias } from "@/server/scoring/bias";
import { brierScore, impliedProbability } from "@/server/scoring/brier";
import { verifyCommitment } from "@/server/scoring/commitment";

export const resolvePickSchema = z.object({
  result: z.enum(["win", "loss", "void"]),
  sourceUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
      message: "sourceUrl must be http(s)",
    }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
  payoutUnits: z.number().int().min(0).max(1_000_000).optional(),
});

export type ResolvePickInput = z.infer<typeof resolvePickSchema>;

export interface ResolvePickResult {
  readonly outcome: OutcomeRow;
  readonly pick: PickRow;
  readonly outcomeBlobId: string;
  readonly biasBlobId: string | null;
  readonly biasPattern: string | null;
  readonly sourceRoiBlobIds: readonly string[];
  /** What the independent provider concluded, when one could be consulted. */
  readonly oracle: {
    readonly result: "win" | "loss" | "void";
    readonly source: string;
    readonly sourceUrl: string;
    readonly score: string;
  } | null;
  /** Why no oracle verdict exists, shown to the user instead of a false claim. */
  readonly oracleNote: string | null;
}

interface OracleDecision {
  readonly verification: "self_attested" | "oracle_verified" | "oracle_contradicted";
  readonly oracleResult: "win" | "loss" | "void" | null;
  readonly oracleSource: string | null;
  readonly oracleEventId: string | null;
  readonly oracleNote: string | null;
  readonly verifiedAt: Date | null;
  readonly display: ResolvePickResult["oracle"];
}

/**
 * Asks the independent provider what happened, and decides how much trust the claim earns.
 *
 * A contradiction does not overwrite the owner's result: the journal is theirs and the
 * stored outcome should record what they claimed. What changes is `verification`, which is
 * what the credibility model reads. A pick the provider disagrees with therefore cannot
 * contribute to a seller's verified record, which is the whole point of the feature.
 */
async function consultOracle(
  pick: PickRow,
  claimed: "win" | "loss" | "void",
): Promise<OracleDecision> {
  const ref = pick.oracleEventRef === null ? null : parseOracleRef(pick.oracleEventRef);

  if (ref === null) {
    return {
      verification: "self_attested",
      oracleResult: null,
      oracleSource: null,
      oracleEventId: null,
      oracleNote:
        "No independent fixture was linked at seal time, so this result is the journal's own claim.",
      verifiedAt: null,
      display: null,
    };
  }

  const selection = parseSelection(pick.selection);
  if (selection === null) {
    return {
      verification: "self_attested",
      oracleResult: null,
      oracleSource: `espn:${ref.league}`,
      oracleEventId: ref.eventId,
      oracleNote: `The selection "${pick.selection}" is not a match-winner pick the oracle can read.`,
      verifiedAt: null,
      display: null,
    };
  }

  let verdict: Awaited<ReturnType<typeof readFixtureResult>>;
  try {
    verdict = await readFixtureResult(ref, selection);
  } catch (error) {
    getLogger().warn(
      { error: errorForLog(error), oracleRef: pick.oracleEventRef },
      "oracle lookup failed; outcome stays self-attested",
    );
    return {
      verification: "self_attested",
      oracleResult: null,
      oracleSource: `espn:${ref.league}`,
      oracleEventId: ref.eventId,
      oracleNote:
        error instanceof AppError
          ? `The results provider could not confirm this fixture: ${error.message}`
          : "The results provider could not confirm this fixture.",
      verifiedAt: null,
      display: null,
    };
  }

  if (verdict === null) {
    return {
      verification: "self_attested",
      oracleResult: null,
      oracleSource: `espn:${ref.league}`,
      oracleEventId: ref.eventId,
      oracleNote: "The fixture has not finished yet, so the provider has no result to compare.",
      verifiedAt: null,
      display: null,
    };
  }

  const agrees = claimed === "void" ? true : claimed === verdict.result;

  return {
    verification: agrees ? "oracle_verified" : "oracle_contradicted",
    oracleResult: verdict.result,
    oracleSource: `espn:${ref.league}`,
    oracleEventId: ref.eventId,
    oracleNote: agrees
      ? null
      : `The provider recorded ${verdict.homeTeam} ${verdict.homeScore}–${verdict.awayScore} ${verdict.awayTeam}, which makes this pick a ${verdict.result}.`,
    verifiedAt: new Date(),
    display: {
      result: verdict.result,
      source: `espn:${ref.league}`,
      sourceUrl: verdict.sourceUrl,
      score: `${verdict.homeTeam} ${verdict.homeScore}–${verdict.awayScore} ${verdict.awayTeam}`,
    },
  };
}

export async function resolvePick(
  userId: string,
  pickId: string,
  input: ResolvePickInput,
): Promise<ResolvePickResult> {
  const db = getDb();
  const rows = await db
    .select({ pick: picks, outcome: outcomes })
    .from(picks)
    .leftJoin(outcomes, eq(outcomes.pickId, picks.id))
    .where(eq(picks.id, pickId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Pick not found.");
  if (row.pick.userId !== userId) {
    throw new AppError("FORBIDDEN", "Only the owner of a pick can resolve it.");
  }
  if (row.outcome) {
    throw new AppError("CONFLICT", "This pick already has an outcome.");
  }
  if (row.pick.status === "sealed") {
    throw new AppError("CONFLICT", "Reveal the sealed commitment before resolving it.");
  }
  if (!verifyCommitment(row.pick.pickPayload, row.pick.commitmentHash)) {
    throw new AppError(
      "CONFLICT",
      "The stored reveal does not match the commitment hash. Resolution refused.",
    );
  }

  const resolvedAt = input.resolvedAt ?? nowIso();
  if (new Date(resolvedAt).getTime() < row.pick.committedAt.getTime()) {
    throw new AppError(
      "VALIDATION_FAILED",
      "An outcome cannot be resolved before the pick was committed.",
    );
  }

  // Ask the independent provider before writing anything. A contradicted claim is stored
  // as contradicted rather than rejected, so the record shows what was claimed and what
  // actually happened side by side.
  const oracle = await consultOracle(row.pick, input.result);
  const probability = impliedProbability(row.pick.odds);
  const brier = brierScore(probability, input.result);

  const inserted = await db.transaction(async (tx) => {
    const created = await tx
      .insert(outcomes)
      .values({
        pickId,
        result: input.result,
        resolvedBy: `user:${userId}`,
        sourceUrl: input.sourceUrl,
        resolvedAt: new Date(resolvedAt),
        verification: oracle.verification,
        oracleResult: oracle.oracleResult,
        oracleSource: oracle.oracleSource,
        oracleEventId: oracle.oracleEventId,
        oracleNote: oracle.oracleNote,
        verifiedAt: oracle.verifiedAt,
        ...(input.payoutUnits === undefined ? {} : { payoutUnits: input.payoutUnits }),
        brier,
      })
      .returning();

    const updated = await tx
      .update(picks)
      .set({
        status: input.result === "void" ? "void" : "resolved",
        revealAt: row.pick.revealAt ?? new Date(resolvedAt),
      })
      .where(eq(picks.id, pickId))
      .returning();

    const outcome = created[0];
    const pick = updated[0];
    if (!outcome || !pick) throw new AppError("INTERNAL", "Resolution could not be persisted.");
    return { outcome, pick };
  });

  const memory = buildOutcomeMemory({
    pickId,
    result: input.result,
    ...(brier === null ? {} : { brier }),
    source: input.sourceUrl,
    resolvedAt,
  });

  let outcomeWrite: Awaited<ReturnType<typeof remember>>;
  try {
    outcomeWrite = await remember(userId, memory);
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.delete(outcomes).where(eq(outcomes.pickId, pickId));
      await tx
        .update(picks)
        .set({ status: row.pick.status, revealAt: row.pick.revealAt })
        .where(eq(picks.id, pickId));
    });
    getLogger().error(
      { error: errorForLog(error), pickId },
      "resolution rolled back because the memory write failed",
    );
    throw new AppError("UPSTREAM_UNAVAILABLE", "Walrus Memory did not accept the outcome.", {
      cause: error,
    });
  }

  let biasBlobId: string | null = null;
  let biasPattern: string | null = null;

  try {
    const samples = await loadAnalystSamples(row.pick.analystId);
    const patterns = detectBias(
      samples.map((sample) => ({
        odds: sample.pick.odds,
        outcome: sample.outcome.result,
      })),
      UNDERDOG_ODDS_THRESHOLD,
    );
    const top = patterns[0];
    if (top) {
      const write = await remember(
        userId,
        buildBiasMemory({
          analyst: row.pick.analystId,
          pattern: top.pattern,
          evidence: top.evidence,
          confidence: top.confidence,
        }),
      );
      biasBlobId = write.blobId;
      biasPattern = top.pattern;
    }
  } catch (error) {
    getLogger().warn(
      { error: errorForLog(error), pickId },
      "bias memory could not be derived; resolution remains valid",
    );
  }

  const sourceRoiBlobIds: string[] = [];
  try {
    const providers = await providersForPick(pickId);
    for (const provider of providers) {
      const stats = await sourceRoi(provider, userId);
      const write = await remember(
        userId,
        buildSourceRoiMemory({
          provider: stats.provider,
          spendAtomic: stats.spendAtomic.toString(),
          correct: stats.correct,
          wrong: stats.wrong,
          note:
            stats.resolved === 0
              ? "No resolved pick linked to this source yet."
              : `Net hit rate ${(stats.roi * 100).toFixed(1)}% across ${stats.resolved} linked picks.`,
        }),
      );
      sourceRoiBlobIds.push(write.blobId);
    }
  } catch (error) {
    getLogger().warn(
      { error: errorForLog(error), pickId },
      "source ROI memory could not be derived",
    );
  }

  return {
    outcome: inserted.outcome,
    pick: inserted.pick,
    outcomeBlobId: outcomeWrite.blobId,
    biasBlobId,
    biasPattern,
    sourceRoiBlobIds,
    oracle: oracle.display,
    oracleNote: oracle.oracleNote,
  };
}
