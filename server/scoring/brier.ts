/** Brier scoring for a single binary market. Pure functions, unit-tested. */

export type BinaryOutcome = "win" | "loss" | "void";

export function impliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new Error("Decimal odds must be greater than 1");
  }
  return 1 / decimalOdds;
}

export function brierScore(probability: number, outcome: BinaryOutcome): number | null {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("Probability must be between 0 and 1");
  }
  if (outcome === "void") return null;
  const actual = outcome === "win" ? 1 : 0;
  const delta = probability - actual;
  return delta * delta;
}

export function meanBrier(scores: ReadonlyArray<number>): number | null {
  if (scores.length === 0) return null;
  const total = scores.reduce((sum, score) => sum + score, 0);
  return total / scores.length;
}

export interface CalibrationBin {
  readonly label: string;
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  readonly predicted: number;
  readonly observed: number;
}

/** Bins predictions into deciles so overconfidence is visible, not averaged away. */
export function calibrationBins(
  samples: ReadonlyArray<{ probability: number; outcome: "win" | "loss" }>,
): CalibrationBin[] {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}–${index * 10 + 10}%`,
    lower: index / 10,
    upper: (index + 1) / 10,
    count: 0,
    predictedSum: 0,
    observedSum: 0,
  }));

  for (const sample of samples) {
    const bounded = Math.min(0.999_999, Math.max(0, sample.probability));
    const index = Math.floor(bounded * 10);
    const bin = bins[index];
    if (!bin) continue;
    bin.count += 1;
    bin.predictedSum += sample.probability;
    bin.observedSum += sample.outcome === "win" ? 1 : 0;
  }

  return bins.map((bin) => ({
    label: bin.label,
    lower: bin.lower,
    upper: bin.upper,
    count: bin.count,
    predicted: bin.count === 0 ? 0 : bin.predictedSum / bin.count,
    observed: bin.count === 0 ? 0 : bin.observedSum / bin.count,
  }));
}
