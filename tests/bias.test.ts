import { describe, expect, it } from "vitest";

import { detectBias } from "@/server/scoring/bias";

describe("detectBias", () => {
  it("stays quiet until there is repeated evidence", () => {
    expect(detectBias([{ odds: 3, outcome: "loss" }])).toEqual([]);
    expect(
      detectBias([
        { odds: 3, outcome: "loss" },
        { odds: 3, outcome: "win" },
        { odds: 3, outcome: "win" },
      ]),
    ).toEqual([]);
  });

  it("reports repeated underdog losses with confidence", () => {
    const patterns = detectBias([
      { odds: 3.2, outcome: "loss" },
      { odds: 2.8, outcome: "loss" },
      { odds: 4.1, outcome: "loss" },
      { odds: 3.0, outcome: "win" },
    ]);

    const underdog = patterns.find((pattern) => pattern.pattern.includes("underdog"));
    expect(underdog).toBeDefined();
    expect(underdog?.evidence).toBe(3);
    expect(underdog?.sample).toBe(4);
    expect(underdog?.confidence).toBeCloseTo(4 / 6);
  });

  it("ignores void samples when building the pattern", () => {
    const patterns = detectBias([
      { odds: 3.2, outcome: "loss" },
      { odds: 3.1, outcome: "void" },
    ]);

    expect(patterns.find((pattern) => pattern.pattern.includes("underdog"))).toBeUndefined();
  });

  it("detects overconfidence on heavy favourites", () => {
    const patterns = detectBias([
      { odds: 1.2, outcome: "loss" },
      { odds: 1.3, outcome: "loss" },
      { odds: 1.1, outcome: "win" },
    ]);

    expect(patterns.some((pattern) => pattern.pattern.startsWith("overconfidence"))).toBe(true);
  });

  it("sorts the strongest pattern first", () => {
    const patterns = detectBias([
      { odds: 1.2, outcome: "loss" },
      { odds: 1.3, outcome: "loss" },
      { odds: 4, outcome: "loss" },
      { odds: 4, outcome: "loss" },
    ]);

    expect(patterns.length).toBeGreaterThan(1);
    for (let index = 1; index < patterns.length; index += 1) {
      const previous = patterns[index - 1];
      const current = patterns[index];
      if (!previous || !current) throw new Error("missing pattern");
      expect(previous.confidence).toBeGreaterThanOrEqual(current.confidence);
    }
  });
});
