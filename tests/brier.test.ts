import { describe, expect, it } from "vitest";

import { brierScore, calibrationBins, impliedProbability, meanBrier } from "@/server/scoring/brier";

describe("impliedProbability", () => {
  it("inverts decimal odds", () => {
    expect(impliedProbability(2)).toBe(0.5);
    expect(impliedProbability(4)).toBe(0.25);
  });

  it("rejects odds that cannot imply a probability", () => {
    expect(() => impliedProbability(1)).toThrow();
    expect(() => impliedProbability(0)).toThrow();
    expect(() => impliedProbability(Number.NaN)).toThrow();
  });
});

describe("brierScore", () => {
  it("scores a confident correct call lower than a doubtful one", () => {
    expect(brierScore(0.9, "win")).toBeCloseTo(0.01);
    expect(brierScore(0.6, "win")).toBeCloseTo(0.16);
  });

  it("scores confident misses harshly", () => {
    expect(brierScore(0.9, "loss")).toBeCloseTo(0.81);
  });

  it("returns null for a void outcome", () => {
    expect(brierScore(0.5, "void")).toBeNull();
  });

  it("rejects probabilities outside [0, 1]", () => {
    expect(() => brierScore(-0.1, "win")).toThrow();
    expect(() => brierScore(1.1, "win")).toThrow();
  });
});

describe("meanBrier", () => {
  it("returns null for an empty sample", () => {
    expect(meanBrier([])).toBeNull();
  });

  it("averages scores", () => {
    expect(meanBrier([0.01, 0.09, 0.25])).toBeCloseTo(0.116_666, 5);
  });
});

describe("calibrationBins", () => {
  it("bins by implied probability and reports observed frequency", () => {
    const bins = calibrationBins([
      { probability: 0.85, outcome: "win" },
      { probability: 0.83, outcome: "loss" },
      { probability: 0.31, outcome: "loss" },
    ]);

    expect(bins).toHaveLength(10);
    const eighties = bins[8];
    const thirties = bins[3];
    if (!eighties || !thirties) throw new Error("missing bin");

    expect(eighties.count).toBe(2);
    expect(eighties.predicted).toBeCloseTo(0.84);
    expect(eighties.observed).toBeCloseTo(0.5);
    expect(thirties.count).toBe(1);
    expect(thirties.observed).toBe(0);
  });

  it("clamps a probability of exactly one into the last bin", () => {
    const bins = calibrationBins([{ probability: 1, outcome: "win" }]);
    expect(bins[9]?.count).toBe(1);
  });
});
