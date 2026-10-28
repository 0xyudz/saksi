import { describe, expect, it } from "vitest";

import { formatAtomic, formatUsd, parsePriceToAtomic } from "@/lib/price";

describe("parsePriceToAtomic", () => {
  it("scales a USD price to six-decimal atomic units", () => {
    expect(parsePriceToAtomic("$0.01")).toBe(10_000n);
    expect(parsePriceToAtomic("$1")).toBe(1_000_000n);
    expect(parsePriceToAtomic("$1.5")).toBe(1_500_000n);
    expect(parsePriceToAtomic("$0.000001")).toBe(1n);
  });

  it("treats a bare integer as atomic units", () => {
    expect(parsePriceToAtomic("2500")).toBe(2_500n);
  });

  it("rejects invalid prices and excess precision", () => {
    expect(() => parsePriceToAtomic("$0.0000001")).toThrow();
    expect(() => parsePriceToAtomic("$1e3")).toThrow();
    expect(() => parsePriceToAtomic("free")).toThrow();
    expect(() => parsePriceToAtomic("$")).toThrow();
  });
});

describe("formatAtomic", () => {
  it("renders atomic units without trailing zeroes", () => {
    expect(formatAtomic(10_000n)).toBe("0.01");
    expect(formatAtomic(1_500_000n)).toBe("1.5");
    expect(formatAtomic(1_000_000n)).toBe("1");
    expect(formatAtomic(1n)).toBe("0.000001");
  });

  it("supports negative amounts", () => {
    expect(formatAtomic(-15_000n)).toBe("-0.015");
  });
});

describe("formatUsd", () => {
  it("prefixes the amount with a dollar sign", () => {
    expect(formatUsd(2_500_000n)).toBe("$2.5");
  });
});
