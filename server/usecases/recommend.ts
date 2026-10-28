import { z } from "zod";

import { getDb } from "@/db/client";
import { recommendations } from "@/db/schema";
import { recall } from "@/integrations/walrus-memory/client";
import type { ParsedMemory } from "@/integrations/walrus-memory/schema";
import { UNDERDOG_ODDS_THRESHOLD } from "@/lib/config";
import type {
  MemoryCitation,
  RecommendationResponse,
  RecommendationSource,
  RecommendationWarning,
  RecommendationVerdict,
} from "@/lib/domain";
import { AppError } from "@/lib/errors";
import { getLogger, errorForLog } from "@/lib/logger";
import { analystCredibility } from "@/server/data/picks";

export const recommendSchema = z.object({
  analystId: z.string().uuid(),
  market: z.string().trim().min(2).max(200),
  selection: z.string().trim().min(1).max(200),
  odds: z.number().gt(1).max(1000),
  pickId: z.string().uuid().optional(),
});

export type RecommendInput = z.infer<typeof recommendSchema>;

export interface Recommendation {
  readonly id: string;
  readonly verdict: RecommendationVerdict;
  readonly confidence: number;
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly RecommendationWarning[];
  readonly sources: readonly RecommendationSource[];
  readonly citations: readonly MemoryCitation[];
  readonly recallCount: number;
}

function citationFor(memory: ParsedMemory, citations: readonly MemoryCitation[]): MemoryCitation {
  const match = citations.find((citation) => citation.text === memory.text);
  if (!match) throw new AppError("INTERNAL", "Memory citation could not be resolved.");
  return match;
}

function verdictFromCredibility(score: number, resolved: number): RecommendationVerdict {
  if (resolved < 3) return "reduce";
  if (score >= 55) return "proceed";
  if (score >= 35) return "reduce";
  return "avoid";
}

function downgrade(verdict: RecommendationVerdict): RecommendationVerdict {
  if (verdict === "proceed") return "reduce";
  return "avoid";
}

/**
 * Recalls Walrus Memory first, then makes the decision. Every warning in the result
 * points at the memory blob and cosine distance that caused it.
 */
export async function recommend(userId: string, input: RecommendInput): Promise<Recommendation> {
  const query = [
    input.market,
    input.selection,
    `odds ${input.odds}`,
    input.odds >= UNDERDOG_ODDS_THRESHOLD ? "underdog" : "favourite",
    "analyst bias credibility source roi",
  ].join(" | ");

  const credibility = await analystCredibility(input.analystId);
  const recalled = await recall(userId, query);

  const warnings: RecommendationWarning[] = [];
  const sources: RecommendationSource[] = [];
  const reasons: string[] = [];
  const used: MemoryCitation[] = [];

  const analystBias = recalled.parsed.filter(
    (memory): memory is Extract<ParsedMemory, { kind: "bias" }> =>
      memory.kind === "bias" && memory.analyst === input.analystId,
  );

  for (const memory of analystBias) {
    const citation = citationFor(memory, recalled.citations);
    used.push(citation);
    const appliesToUnderdog =
      input.odds < UNDERDOG_ODDS_THRESHOLD || memory.pattern.toLowerCase().includes("underdog");
    if (!appliesToUnderdog) continue;

    warnings.push({
      kind: "bias",
      message: memory.pattern,
      evidence: memory.evidence,
      memory: citation,
    });
  }

  const sourceMemories = recalled.parsed.filter(
    (memory): memory is Extract<ParsedMemory, { kind: "source_roi" }> =>
      memory.kind === "source_roi",
  );

  const seenProviders = new Set<string>();
  for (const memory of sourceMemories) {
    if (seenProviders.has(memory.provider)) continue;
    seenProviders.add(memory.provider);

    const citation = citationFor(memory, recalled.citations);
    const resolved = memory.correct + memory.wrong;
    const roi = resolved === 0 ? 0 : (memory.correct - memory.wrong) / resolved;
    sources.push({
      provider: memory.provider,
      spendAtomic: memory.spendAtomic,
      correct: memory.correct,
      wrong: memory.wrong,
      roi,
      memory: citation,
    });

    if (resolved > 0 && roi < 0) {
      used.push(citation);
      warnings.push({
        kind: "source_roi",
        message: `${memory.provider} has a negative hit rate (${(roi * 100).toFixed(1)}%) across ${resolved} linked picks`,
        evidence: resolved,
        memory: citation,
      });
    }
  }
  sources.sort((a, b) => b.roi - a.roi);

  const preferences = recalled.parsed.filter(
    (memory): memory is Extract<ParsedMemory, { kind: "preference" }> =>
      memory.kind === "preference" && memory.userId === userId,
  );
  for (const preference of preferences.slice(0, 2)) {
    const citation = citationFor(preference, recalled.citations);
    used.push(citation);
    reasons.push(`Remembered preference: ${preference.statement}.`);
  }

  const recalledOutcomes = recalled.parsed.filter(
    (memory): memory is Extract<ParsedMemory, { kind: "outcome" }> => memory.kind === "outcome",
  );
  if (recalledOutcomes.length > 0) {
    const wins = recalledOutcomes.filter((memory) => memory.result === "win").length;
    const losses = recalledOutcomes.filter((memory) => memory.result === "loss").length;
    const citation = citationFor(recalledOutcomes[0] as ParsedMemory, recalled.citations);
    used.push(citation);
    reasons.push(
      `Recalled ${recalledOutcomes.length} outcome memories: ${wins} wins, ${losses} losses.`,
    );
  }

  if (credibility.resolved === 0) {
    warnings.push({
      kind: "credibility",
      message: "No resolved picks for this analyst yet — credibility is unproven.",
      evidence: 0,
      memory: null,
    });
    reasons.push("Credibility score is 0 because the analyst has no resolved history.");
  } else {
    reasons.push(
      `Analyst credibility ${credibility.score}/100 from ${credibility.resolved} resolved picks ` +
        `(win rate ${(credibility.winRate * 100).toFixed(1)}%, Brier ${credibility.meanBrier?.toFixed(3) ?? "n/a"}).`,
    );
    if (credibility.meanBrier !== null && credibility.meanBrier > 0.25) {
      warnings.push({
        kind: "calibration",
        message: `Mean Brier score ${credibility.meanBrier.toFixed(3)} indicates poor calibration.`,
        evidence: credibility.resolved,
        memory: null,
      });
    }
  }

  let verdict = verdictFromCredibility(credibility.score, credibility.resolved);
  const baseVerdict = verdict;

  if (warnings.some((warning) => warning.kind === "bias" && warning.evidence >= 2)) {
    verdict = downgrade(verdict);
    reasons.push("Verdict downgraded because a recalled bias pattern applies to this pick.");
  }
  if (warnings.some((warning) => warning.kind === "source_roi")) {
    verdict = downgrade(verdict);
    reasons.push("Verdict downgraded because a paid source has negative ROI in memory.");
  }

  const confidence = Math.max(
    0.05,
    Math.min(0.95, 0.35 + credibility.score / 200 - warnings.length * 0.05),
  );

  const uniqueCitations = [
    ...new Map(used.map((citation) => [citation.blobId, citation])).values(),
  ];

  const summary =
    verdict === baseVerdict
      ? `${input.selection} at ${input.odds} is ${verdict === "proceed" ? "supported" : "cautious"} by ${credibility.resolved} resolved picks and ${uniqueCitations.length} recalled memories.`
      : `Memory changed the verdict from ${baseVerdict} to ${verdict}: ${warnings[0]?.message ?? "recalled patterns"}.`;

  const response: RecommendationResponse = {
    verdict,
    confidence,
    summary,
    reasons,
    warnings,
    sources,
    citations: uniqueCitations,
  };

  const inserted = await getDb()
    .insert(recommendations)
    .values({
      pickId: input.pickId ?? null,
      query,
      response,
      citedMemoryIds: uniqueCitations.map((citation) => citation.blobId),
    })
    .returning({ id: recommendations.id });

  const id = inserted[0]?.id;
  if (!id) throw new AppError("INTERNAL", "The recommendation could not be persisted.");

  getLogger().info(
    { recommendationId: id, recalled: recalled.citations.length, cited: uniqueCitations.length },
    "recommendation generated from memory",
  );

  return {
    id,
    ...response,
    recallCount: recalled.citations.length,
  };
}

export async function recommendSafely(
  userId: string,
  input: RecommendInput,
): Promise<Recommendation> {
  try {
    return await recommend(userId, input);
  } catch (error) {
    getLogger().error({ error: errorForLog(error) }, "recommendation failed");
    throw error;
  }
}
