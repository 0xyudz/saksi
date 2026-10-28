import { BIAS_MIN_EVIDENCE, UNDERDOG_ODDS_THRESHOLD } from "@/lib/config";

export interface BiasSample {
  readonly odds: number;
  readonly outcome: "win" | "loss" | "void";
}

export interface BiasPattern {
  readonly pattern: string;
  readonly evidence: number;
  readonly sample: number;
  readonly confidence: number;
}

function confidence(losses: number, sample: number): number {
  // Laplace-smoothed loss rate; small samples stay honest instead of shouting.
  return (losses + 1) / (sample + 2);
}

/** Finds repeated losing behaviour that a recommender can cite before the next pick. */
export function detectBias(
  samples: ReadonlyArray<BiasSample>,
  underdogThreshold: number = UNDERDOG_ODDS_THRESHOLD,
): BiasPattern[] {
  const underdogs = samples.filter(
    (sample) => sample.odds >= underdogThreshold && sample.outcome !== "void",
  );
  const underdogLosses = underdogs.filter((sample) => sample.outcome === "loss").length;

  const favourites = samples.filter(
    (sample) => sample.odds < underdogThreshold && sample.outcome !== "void",
  );
  const favouriteLosses = favourites.filter((sample) => sample.outcome === "loss").length;

  const patterns: BiasPattern[] = [];

  if (underdogs.length >= BIAS_MIN_EVIDENCE && underdogLosses >= BIAS_MIN_EVIDENCE) {
    patterns.push({
      pattern: `${underdogLosses} of ${underdogs.length} underdog picks (odds ≥ ${underdogThreshold}) lost`,
      evidence: underdogLosses,
      sample: underdogs.length,
      confidence: confidence(underdogLosses, underdogs.length),
    });
  }

  if (favourites.length >= BIAS_MIN_EVIDENCE && favouriteLosses >= BIAS_MIN_EVIDENCE) {
    patterns.push({
      pattern: `${favouriteLosses} of ${favourites.length} favourite picks (odds < ${underdogThreshold}) lost`,
      evidence: favouriteLosses,
      sample: favourites.length,
      confidence: confidence(favouriteLosses, favourites.length),
    });
  }

  const highConfidence = samples.filter((sample) => sample.odds < 1.5 && sample.outcome === "loss");
  const highConfidenceResolved = samples.filter(
    (sample) => sample.odds < 1.5 && sample.outcome !== "void",
  );
  if (
    highConfidenceResolved.length >= BIAS_MIN_EVIDENCE &&
    highConfidence.length >= BIAS_MIN_EVIDENCE
  ) {
    patterns.push({
      pattern: `overconfidence: ${highConfidence.length} of ${highConfidenceResolved.length} heavy favourites (odds < 1.5) lost`,
      evidence: highConfidence.length,
      sample: highConfidenceResolved.length,
      confidence: confidence(highConfidence.length, highConfidenceResolved.length),
    });
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}
