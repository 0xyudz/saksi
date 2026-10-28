import { CREDIBILITY_HALF_LIFE_DAYS, WILSON_Z } from "@/lib/config";

export interface CredibilitySample {
  readonly outcome: "win" | "loss" | "void";
  readonly brier: number | null;
  readonly resolvedAt: Date | string;
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
    };
  }

  let weightSum = 0;
  let weightedWins = 0;
  let brierWeightSum = 0;
  let weightedBrier = 0;

  for (const sample of resolved) {
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

  const effectiveWins = weightSum === 0 ? 0 : weightedWins;
  const effectiveTotal = weightSum;
  const winRate = effectiveTotal === 0 ? 0 : effectiveWins / effectiveTotal;
  const wilson = wilsonLowerBound(effectiveWins, effectiveTotal, WILSON_Z);
  const meanBrier = brierWeightSum === 0 ? null : weightedBrier / brierWeightSum;
  const calibration = meanBrier === null ? 0 : Math.max(0, 1 - meanBrier);

  // Accuracy dominates; calibration keeps lucky high-odds runs from topping the board.
  const score = Math.round(Math.max(0, Math.min(1, 0.65 * wilson + 0.35 * calibration)) * 100);

  return {
    resolved: resolved.length,
    wins,
    losses,
    voids,
    winRate,
    wilsonLower: wilson,
    meanBrier,
    calibration,
    score,
  };
}
