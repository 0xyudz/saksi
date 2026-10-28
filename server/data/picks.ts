import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { analysts, outcomes, picks, users, type AnalystRow, type PickRow } from "@/db/schema";
import type { CredibilityBreakdown } from "@/server/scoring/credibility";
import { credibilityBreakdown, type CredibilitySample } from "@/server/scoring/credibility";

export interface AnalystSamples {
  readonly pick: PickRow;
  readonly outcome: {
    readonly result: "win" | "loss" | "void";
    readonly brier: number | null;
    readonly resolvedAt: Date;
    readonly sourceUrl: string;
    readonly resolvedBy: string;
  };
}

export async function loadAnalystSamples(analystId: string): Promise<AnalystSamples[]> {
  const rows = await getDb()
    .select({
      pick: picks,
      result: outcomes.result,
      brier: outcomes.brier,
      resolvedAt: outcomes.resolvedAt,
      sourceUrl: outcomes.sourceUrl,
      resolvedBy: outcomes.resolvedBy,
    })
    .from(picks)
    .innerJoin(outcomes, eq(outcomes.pickId, picks.id))
    .where(eq(picks.analystId, analystId))
    .orderBy(desc(outcomes.resolvedAt));

  return rows.map((row) => ({
    pick: row.pick,
    outcome: {
      result: row.result,
      brier: row.brier,
      resolvedAt: row.resolvedAt,
      sourceUrl: row.sourceUrl,
      resolvedBy: row.resolvedBy,
    },
  }));
}

export async function analystCredibility(
  analystId: string,
  now: Date = new Date(),
): Promise<CredibilityBreakdown> {
  const samples = await loadAnalystSamples(analystId);
  const mapped: CredibilitySample[] = samples.map((sample) => ({
    outcome: sample.outcome.result,
    brier: sample.outcome.brier,
    resolvedAt: sample.outcome.resolvedAt,
  }));
  return credibilityBreakdown(mapped, now);
}

export async function getAnalyst(analystId: string): Promise<AnalystRow | null> {
  const rows = await getDb().select().from(analysts).where(eq(analysts.id, analystId)).limit(1);
  return rows[0] ?? null;
}

export interface LeaderboardEntry {
  readonly analyst: AnalystRow;
  readonly credibility: CredibilityBreakdown;
  /** Resolved samples whose outcome was supplied by the pick owner, not an oracle. */
  readonly communityAttestedSamples: number;
}

export async function leaderboard(now: Date = new Date()): Promise<LeaderboardEntry[]> {
  const db = getDb();
  const rows = await db
    .select({ analyst: analysts, outcome: outcomes })
    .from(analysts)
    .leftJoin(picks, eq(picks.analystId, analysts.id))
    .leftJoin(outcomes, eq(outcomes.pickId, picks.id));

  const grouped = new Map<
    string,
    { analyst: AnalystRow; samples: CredibilitySample[]; communityAttestedSamples: number }
  >();
  for (const row of rows) {
    const entry = grouped.get(row.analyst.id) ?? {
      analyst: row.analyst,
      samples: [],
      communityAttestedSamples: 0,
    };
    if (row.outcome) {
      entry.samples.push({
        outcome: row.outcome.result,
        brier: row.outcome.brier,
        resolvedAt: row.outcome.resolvedAt,
      });
      if (row.outcome.resolvedBy.startsWith("user:")) entry.communityAttestedSamples += 1;
    }
    grouped.set(row.analyst.id, entry);
  }

  return [...grouped.values()]
    .map((entry) => ({
      analyst: entry.analyst,
      credibility: credibilityBreakdown(entry.samples, now),
      communityAttestedSamples: entry.communityAttestedSamples,
    }))
    .sort((a, b) => b.credibility.score - a.credibility.score);
}

export async function listPicksForAnalyst(analystId: string, limit = 20): Promise<PickRow[]> {
  return getDb()
    .select()
    .from(picks)
    .where(eq(picks.analystId, analystId))
    .orderBy(desc(picks.committedAt))
    .limit(limit);
}

export async function picksByIds(ids: ReadonlyArray<string>): Promise<PickRow[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(picks)
    .where(inArray(picks.id, [...ids]));
}

export async function getPickWithOutcome(
  pickId: string,
): Promise<{ pick: PickRow; outcome: typeof outcomes.$inferSelect | null } | null> {
  const rows = await getDb()
    .select({ pick: picks, outcome: outcomes })
    .from(picks)
    .leftJoin(outcomes, eq(outcomes.pickId, picks.id))
    .where(eq(picks.id, pickId))
    .limit(1);

  const row = rows[0];
  return row ? { pick: row.pick, outcome: row.outcome } : null;
}

export async function pickForUser(pickId: string, userId: string): Promise<PickRow | null> {
  const rows = await getDb()
    .select()
    .from(picks)
    .where(and(eq(picks.id, pickId), eq(picks.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface PickDetail {
  readonly pick: PickRow;
  readonly outcome: typeof outcomes.$inferSelect | null;
  readonly analystName: string;
  readonly analystKind: AnalystRow["kind"];
  readonly ownerHandle: string;
}

export async function getPickDetail(pickId: string): Promise<PickDetail | null> {
  const rows = await getDb()
    .select({
      pick: picks,
      outcome: outcomes,
      analystName: analysts.name,
      analystKind: analysts.kind,
      ownerHandle: users.handle,
    })
    .from(picks)
    .innerJoin(analysts, eq(analysts.id, picks.analystId))
    .innerJoin(users, eq(users.id, picks.userId))
    .leftJoin(outcomes, eq(outcomes.pickId, picks.id))
    .where(eq(picks.id, pickId))
    .limit(1);

  const row = rows[0];
  return row
    ? {
        pick: row.pick,
        outcome: row.outcome,
        analystName: row.analystName,
        analystKind: row.analystKind,
        ownerHandle: row.ownerHandle,
      }
    : null;
}

export interface PickFeedItem {
  readonly pick: PickRow;
  readonly analystName: string;
  readonly analystKind: AnalystRow["kind"];
  readonly userHandle: string;
  readonly outcome: {
    readonly result: "win" | "loss" | "void";
    readonly resolvedAt: Date;
    readonly sourceUrl: string;
    readonly resolvedBy: string;
    readonly brier: number | null;
  } | null;
}

export async function recentPicks(limit = 50, userId?: string): Promise<PickFeedItem[]> {
  const db = getDb();
  const base = db
    .select({
      pick: picks,
      analystName: analysts.name,
      analystKind: analysts.kind,
      userHandle: users.handle,
      result: outcomes.result,
      resolvedAt: outcomes.resolvedAt,
      sourceUrl: outcomes.sourceUrl,
      resolvedBy: outcomes.resolvedBy,
      brier: outcomes.brier,
    })
    .from(picks)
    .innerJoin(analysts, eq(analysts.id, picks.analystId))
    .innerJoin(users, eq(users.id, picks.userId))
    .leftJoin(outcomes, eq(outcomes.pickId, picks.id));

  const rows = await (userId === undefined
    ? base.orderBy(desc(picks.committedAt)).limit(limit)
    : base.where(eq(picks.userId, userId)).orderBy(desc(picks.committedAt)).limit(limit));

  return rows.map((row) => ({
    pick: row.pick,
    analystName: row.analystName,
    analystKind: row.analystKind,
    userHandle: row.userHandle,
    outcome:
      row.result === null ||
      row.resolvedAt === null ||
      row.sourceUrl === null ||
      row.resolvedBy === null
        ? null
        : {
            result: row.result,
            resolvedAt: row.resolvedAt,
            sourceUrl: row.sourceUrl,
            resolvedBy: row.resolvedBy,
            brier: row.brier,
          },
  }));
}

export interface PickStats {
  readonly total: number;
  readonly sealed: number;
  readonly revealed: number;
  readonly resolved: number;
  readonly voided: number;
}

export async function pickStats(): Promise<PickStats> {
  const rows = await getDb()
    .select({ status: picks.status, total: count() })
    .from(picks)
    .groupBy(picks.status);

  const byStatus = new Map(rows.map((row) => [row.status, Number(row.total)]));
  const total = [...byStatus.values()].reduce((sum, value) => sum + value, 0);

  return {
    total,
    sealed: byStatus.get("sealed") ?? 0,
    revealed: byStatus.get("revealed") ?? 0,
    resolved: byStatus.get("resolved") ?? 0,
    voided: byStatus.get("void") ?? 0,
  };
}
