import { recallNamespace, type RecalledMemoryHit } from "@/integrations/walrus-memory/client";
import type { ParsedMemory } from "@/integrations/walrus-memory/schema";
import { UNDERDOG_ODDS_THRESHOLD } from "@/lib/config";
import { detectBias, type BiasPattern } from "@/server/scoring/bias";
import { credibilityBreakdown, type CredibilityBreakdown } from "@/server/scoring/credibility";

/**
 * Reconstructs a journal's track record from Walrus Memory alone.
 *
 * Nothing here reads Postgres. A commitment memory carries `id` and `analyst`; an outcome
 * memory carries `pickId` and `result`. Joining them on the id is enough to rebuild every
 * number the product shows, which is the claim this module exists to make checkable.
 *
 * Recall is similarity-ranked and capped at 100 per call, so this is a reconstruction from
 * what the relayer returned, not a claim of completeness. Callers get `recalled` alongside
 * the derived numbers so the UI can state how much evidence the answer rests on.
 */

export interface ReconstructedPick {
  readonly pickId: string;
  readonly analystId: string;
  readonly market: string | null;
  readonly selection: string | null;
  readonly odds: number | null;
  readonly committedAt: string | null;
  readonly revealedAt: string | null;
  readonly result: "win" | "loss" | "void" | null;
  readonly brier: number | null;
  readonly source: string | null;
  readonly resolvedAt: string | null;
}

export interface ReconstructedJournal {
  readonly picks: ReadonlyArray<ReconstructedPick>;
  /** Distinct memory kinds seen, so the caller can show what evidence exists. */
  readonly kinds: ReadonlyArray<string>;
  /** How many memories the recall actually returned. */
  readonly recalled: number;
  /** True when recall returned exactly the limit, so more may exist. */
  readonly possiblyTruncated: boolean;
}

const RECALL_QUERY = "pick commitment reveal outcome analyst bias source roi preference payment";
const RECALL_LIMIT = 100;

interface Accumulator {
  pickId: string;
  analystId: string;
  market: string | null;
  selection: string | null;
  odds: number | null;
  committedAt: string | null;
  revealedAt: string | null;
  result: "win" | "loss" | "void" | null;
  brier: number | null;
  source: string | null;
  resolvedAt: string | null;
}

function blank(pickId: string): Accumulator {
  return {
    pickId,
    analystId: "",
    market: null,
    selection: null,
    odds: null,
    committedAt: null,
    revealedAt: null,
    result: null,
    brier: null,
    source: null,
    resolvedAt: null,
  };
}

/** Folds one memory record into the pick it belongs to. */
function apply(byId: Map<string, Accumulator>, memory: ParsedMemory): void {
  switch (memory.kind) {
    case "pick_commit": {
      const entry = byId.get(memory.id) ?? blank(memory.id);
      entry.analystId = memory.analyst;
      entry.market = memory.market;
      entry.committedAt = memory.committedAt;
      byId.set(memory.id, entry);
      return;
    }
    case "pick_reveal": {
      const entry = byId.get(memory.id) ?? blank(memory.id);
      entry.selection = memory.selection;
      entry.odds = memory.odds;
      entry.revealedAt = memory.revealedAt;
      byId.set(memory.id, entry);
      return;
    }
    case "outcome": {
      const entry = byId.get(memory.pickId) ?? blank(memory.pickId);
      entry.result = memory.result;
      entry.brier = memory.brier ?? null;
      entry.source = memory.source;
      entry.resolvedAt = memory.resolvedAt;
      byId.set(memory.pickId, entry);
      return;
    }
    default:
      return;
  }
}

export async function reconstructJournal(namespace: string): Promise<ReconstructedJournal> {
  const { hits } = await recallNamespace(namespace, RECALL_QUERY, RECALL_LIMIT);
  return reconstructFromHits(hits);
}

/** Pure form, so the reconstruction can be tested without a relayer. */
export function reconstructFromHits(hits: ReadonlyArray<RecalledMemoryHit>): ReconstructedJournal {
  const byId = new Map<string, Accumulator>();
  const kinds = new Set<string>();

  for (const hit of hits) {
    if (hit.memory === null) continue;
    kinds.add(hit.memory.kind);
    apply(byId, hit.memory);
  }

  const picks: ReconstructedPick[] = [...byId.values()]
    .filter((entry) => entry.analystId !== "")
    .map((entry) => ({ ...entry }))
    .sort((a, b) => (b.committedAt ?? "").localeCompare(a.committedAt ?? ""));

  return {
    picks,
    kinds: [...kinds].sort(),
    recalled: hits.length,
    possiblyTruncated: hits.length >= RECALL_LIMIT,
  };
}

export interface ReconstructedAnalyst {
  readonly analystId: string;
  readonly credibility: CredibilityBreakdown;
  readonly bias: ReadonlyArray<BiasPattern>;
}

/** Every analyst that appears in the reconstructed journal, with derived numbers. */
export function analystsFromJournal(journal: ReconstructedJournal): ReconstructedAnalyst[] {
  const byAnalyst = new Map<string, ReconstructedPick[]>();
  for (const pick of journal.picks) {
    const list = byAnalyst.get(pick.analystId) ?? [];
    list.push(pick);
    byAnalyst.set(pick.analystId, list);
  }

  const out: ReconstructedAnalyst[] = [];
  for (const [analystId, picks] of byAnalyst) {
    const resolved = picks.filter((pick) => pick.result !== null && pick.odds !== null);
    const credibility = credibilityBreakdown(
      resolved.map((pick) => ({
        outcome: pick.result ?? "void",
        brier: pick.brier,
        resolvedAt: pick.resolvedAt ?? pick.committedAt ?? new Date(0).toISOString(),
        // A memory record is the owner's own claim: there is no oracle flag in the
        // schema, so nothing here can be presented as provider-verified.
        verified: false,
      })),
    );
    const bias = detectBias(
      resolved.map((pick) => ({ odds: pick.odds ?? 0, outcome: pick.result ?? "void" })),
      UNDERDOG_ODDS_THRESHOLD,
    );
    out.push({ analystId, credibility, bias });
  }

  return out.sort((a, b) => b.credibility.score - a.credibility.score);
}
