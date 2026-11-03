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

  it("reports no verified evidence when nothing was oracle-confirmed", () => {
    const result = credibilityBreakdown(
      [
        { outcome: "win", brier: 0.04, resolvedAt: NOW },
        { outcome: "win", brier: 0.04, resolvedAt: NOW },
      ],
      NOW,
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.verifiedResolved).toBe(0);
    expect(result.verifiedScore).toBe(0);
    expect(result.hasVerifiedEvidence).toBe(false);
  });

  it("scores only oracle-confirmed outcomes as verified", () => {
    const result = credibilityBreakdown(
      [
        { outcome: "win", brier: 0.04, resolvedAt: NOW, verified: true },
        { outcome: "win", brier: 0.04, resolvedAt: NOW },
        { outcome: "win", brier: 0.04, resolvedAt: NOW },
      ],
      NOW,
    );

    expect(result.resolved).toBe(3);
    expect(result.wins).toBe(3);
    expect(result.verifiedResolved).toBe(1);
    expect(result.verifiedWins).toBe(1);
    expect(result.hasVerifiedEvidence).toBe(true);
    // One confirmed win cannot outrank a longer confirmed record, so the verified score
    // must stay below the score built from all three.
    expect(result.verifiedScore).toBeLessThan(result.score);
  });

  it("keeps a self-graded record from producing a verified score", () => {
    const selfGraded = credibilityBreakdown(
      Array.from({ length: 20 }, () => ({ outcome: "win" as const, brier: 0.02, resolvedAt: NOW })),
      NOW,
    );

    expect(selfGraded.score).toBeGreaterThan(50);
    expect(selfGraded.verifiedScore).toBe(0);
    expect(selfGraded.hasVerifiedEvidence).toBe(false);
  });

  it("counts a contradicted loss as unverified", () => {
    const result = credibilityBreakdown(
      [
        { outcome: "win", brier: 0.04, resolvedAt: NOW, verified: true },
        { outcome: "loss", brier: 0.36, resolvedAt: NOW },
      ],
      NOW,
    );

    expect(result.resolved).toBe(2);
    expect(result.verifiedResolved).toBe(1);
    expect(result.verifiedWins).toBe(1);
    expect(result.verifiedLosses).toBe(0);
  });
});
