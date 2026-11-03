import { CREDIBILITY_HALF_LIFE_DAYS, WILSON_Z } from "@/lib/config";

export interface CredibilitySample {
  readonly outcome: "win" | "loss" | "void";
  readonly brier: number | null;
  readonly resolvedAt: Date | string;
  /**
   * Whether an independent provider confirmed this outcome. Samples without confirmation
   * still count, but only as unverified: they are reported separately so a seller cannot
   * present a self-graded record as a verified one.
   */
  readonly verified?: boolean;
}

export interface CredibilityBreakdown {
  readonly resolved: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly winRate: number;
  readonly wilsonLower: number;
  readonly meanBrier: number | null;
  readonly calibration: number;
  /** 0–100. Zero when there is no resolved evidence. */
  readonly score: number;
  /**
   * The subset of resolved samples an independent provider confirmed, and the score
   * computed from those alone. A journal can have `score` above zero and `verifiedScore`
   * at zero, which is exactly the distinction a buyer needs to see.
   */
  readonly verifiedResolved: number;
  readonly verifiedWins: number;
  readonly verifiedLosses: number;
  readonly verifiedScore: number;
  /** True once at least one outcome has been confirmed by an independent provider. */
  readonly hasVerifiedEvidence: boolean;
}

function wilsonLowerBound(wins: number, total: number, z: number): number {
  if (total <= 0) return 0;
  const phat = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
}

/**
 * Credibility rewards both accuracy and calibration, and shrinks small samples toward
 * zero. Recency is weighted with a 90-day half-life so old streaks decay.
 *
 * Two scores are produced from the same samples. `score` uses everything the journal has
 * resolved; `verifiedScore` uses only the outcomes an independent provider confirmed.
 * The second is the one a buyer should trust, because the first can be manufactured by
 * marking your own picks as wins.
 */
export function credibilityBreakdown(
  samples: ReadonlyArray<CredibilitySample>,
  now: Date = new Date(),
): CredibilityBreakdown {
  const resolved = samples.filter((sample) => sample.outcome !== "void");
  const voids = samples.length - resolved.length;
  const wins = resolved.filter((sample) => sample.outcome === "win").length;
  const losses = resolved.length - wins;

  if (resolved.length === 0) {
    return {
      resolved: 0,
      wins: 0,
      losses: 0,
      voids,
      winRate: 0,
      wilsonLower: 0,
      meanBrier: null,
      calibration: 0,
      score: 0,
      verifiedResolved: 0,
      verifiedWins: 0,
      verifiedLosses: 0,
      verifiedScore: 0,
      hasVerifiedEvidence: false,
    };
  }

  const overall = weightedScore(resolved, now);
  const verifiedSamples = resolved.filter((sample) => sample.verified === true);
  const verified = weightedScore(verifiedSamples, now);
  const verifiedWins = verifiedSamples.filter((sample) => sample.outcome === "win").length;
  const verifiedLosses = verifiedSamples.length - verifiedWins;

  return {
    resolved: resolved.length,
    wins,
    losses,
    voids,
    winRate: overall.winRate,
    wilsonLower: overall.wilsonLower,
    meanBrier: overall.meanBrier,
    calibration: overall.calibration,
    score: overall.score,
    verifiedResolved: verifiedSamples.length,
    verifiedWins,
    verifiedLosses,
    verifiedScore: verified.score,
    hasVerifiedEvidence: verifiedSamples.length > 0,
  };
}

interface WeightedScore {
  readonly winRate: number;
  readonly wilsonLower: number;
  readonly meanBrier: number | null;
  readonly calibration: number;
  readonly score: number;
}

const EMPTY_SCORE: WeightedScore = {
  winRate: 0,
  wilsonLower: 0,
  meanBrier: null,
  calibration: 0,
  score: 0,
};

function weightedScore(samples: ReadonlyArray<CredibilitySample>, now: Date): WeightedScore {
  if (samples.length === 0) return EMPTY_SCORE;

  let weightSum = 0;
  let weightedWins = 0;
  let brierWeightSum = 0;
  let weightedBrier = 0;

  for (const sample of samples) {
    const ageDays = Math.max(
      0,
      (now.getTime() - new Date(sample.resolvedAt).getTime()) / 86_400_000,
    );
    const weight = Math.pow(0.5, ageDays / CREDIBILITY_HALF_LIFE_DAYS);
    weightSum += weight;
    if (sample.outcome === "win") weightedWins += weight;

    if (sample.brier !== null) {
      brierWeightSum += weight;
      weightedBrier += sample.brier * weight;
    }
  }

  const winRate = weightSum === 0 ? 0 : weightedWins / weightSum;
  const wilson = wilsonLowerBound(weightedWins, weightSum, WILSON_Z);
  const meanBrier = brierWeightSum === 0 ? null : weightedBrier / brierWeightSum;
  const calibration = meanBrier === null ? 0 : Math.max(0, 1 - meanBrier);

  // Accuracy dominates; calibration keeps lucky high-odds runs from topping the board.
  const score = Math.round(Math.max(0, Math.min(1, 0.65 * wilson + 0.35 * calibration)) * 100);

  return { winRate, wilsonLower: wilson, meanBrier, calibration, score };
}
