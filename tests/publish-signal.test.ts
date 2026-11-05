import { describe, expect, it } from "vitest";

import { listingPriceProblem, publishSignalSchema } from "@/server/usecases/publish-signal";

const base = {
  title: "Arsenal match winner",
  externalRef: "mw11-arsenal",
  payload: { note: "seller research" },
  digest: "A1b2C3d4E5f6",
};

function parse(priceAtomic: string | number) {
  return publishSignalSchema.safeParse({ ...base, priceAtomic });
}

describe("publishSignalSchema priceAtomic", () => {
  it("accepts an integer string in atomic units", () => {
    const parsed = parse("10000");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.priceAtomic).toBe(10_000n);
  });

  it("accepts a whole number", () => {
    const parsed = parse(10_000);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.priceAtomic).toBe(10_000n);
  });

  it("rejects a decimal USD string without throwing", () => {
    /*
     * `BigInt("0.05")` throws a SyntaxError. If that happens inside a Zod transform,
     * `safeParse` cannot report it and the route answers 500 after the listing fee has
     * already been settled. The schema must return a normal validation error instead.
     */
    expect(() => parse("0.05")).not.toThrow();
    const parsed = parse("0.05");
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain("whole number");
    }
  });

  it("rejects other malformed amounts", () => {
    for (const value of ["1.5", "-5", "abc", "", "1e6", " 12 34 "]) {
      expect(() => parse(value)).not.toThrow();
      expect(parse(value).success).toBe(false);
    }
  });

  it("enforces the gasless floor and the sanity ceiling", () => {
    expect(parse("9999").success).toBe(false);
    expect(parse("100000001").success).toBe(false);
  });
});

describe("listingPriceProblem", () => {
  const FEE = 20_000n;

  /*
   * The schema floor is the Sui gasless minimum (10000), which is below the flat listing fee
   * (20000). A listing priced in that gap passes validation but can never recover the fee, so
   * the rule lives in the use case, where the configured fee is known.
   */
  it("rejects a price below the listing fee, which could never break even", () => {
    const problem = listingPriceProblem(10_000n, FEE);
    expect(problem).not.toBeNull();
    expect(problem?.path).toBe("priceAtomic");
    expect(problem?.message).toContain("20000");
  });

  it("accepts a price exactly equal to the listing fee", () => {
    expect(listingPriceProblem(FEE, FEE)).toBeNull();
  });

  it("accepts a price above the listing fee", () => {
    expect(listingPriceProblem(50_000n, FEE)).toBeNull();
  });

  it("follows the configured fee rather than a hard-coded one", () => {
    // A cheaper fee makes previously unprofitable listings valid, which is the point of
    // deriving the rule from configuration instead of from a constant.
    expect(listingPriceProblem(10_000n, 10_000n)).toBeNull();
  });
});
