import { describe, expect, it } from "vitest";

import { credibilityBreakdown } from "@/server/scoring/credibility";

const NOW = new Date("2026-10-28T00:00:00.000Z");

describe("credibilityBreakdown", () => {
  it("starts at zero with no resolved evidence", () => {
    const result = credibilityBreakdown([], NOW);
    expect(result).toMatchObject({
      resolved: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      meanBrier: null,
      score: 0,
    });
  });

  it("counts voids separately from resolved picks", () => {
    const result = credibilityBreakdown(
      [
        { outcome: "win", brier: 0.04, resolvedAt: NOW },
        { outcome: "void", brier: null, resolvedAt: NOW },
      ],
      NOW,
    );
    expect(result.resolved).toBe(1);
    expect(result.wins).toBe(1);
    expect(result.voids).toBe(1);
  });

  it("rewards calibration and accuracy", () => {
    const result = credibilityBreakdown(
      [
        { outcome: "win", brier: 0.01, resolvedAt: NOW },
        { outcome: "win", brier: 0.04, resolvedAt: NOW },
        { outcome: "loss", brier: 0.36, resolvedAt: NOW },
      ],
      NOW,
    );

    expect(result.resolved).toBe(3);
    expect(result.winRate).toBeCloseTo(2 / 3);
    expect(result.meanBrier).toBeCloseTo(0.136_666, 5);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("decays older evidence relative to recent evidence", () => {
    const recent = credibilityBreakdown(
      [{ outcome: "win", brier: 0.04, resolvedAt: "2026-10-01T00:00:00.000Z" }],
      NOW,
    );
    const old = credibilityBreakdown(
      [{ outcome: "win", brier: 0.04, resolvedAt: "2020-01-01T00:00:00.000Z" }],
      NOW,
    );

    expect(recent.score).toBeGreaterThan(old.score);
  });

  it("keeps losing records below winning records", () => {
    const winner = credibilityBreakdown([{ outcome: "win", brier: 0.05, resolvedAt: NOW }], NOW);
    const loser = credibilityBreakdown([{ outcome: "loss", brier: 0.8, resolvedAt: NOW }], NOW);

    expect(loser.score).toBeLessThan(winner.score);
    expect(loser.meanBrier).toBeCloseTo(0.8);
  });
});
