import { describe, expect, it } from "vitest";

import { normalizeCoinType } from "@/lib/coin-type";

const FULL_ADDRESS = `0x${"0".repeat(63)}2`;

describe("coin type normalization", () => {
  it("normalizes short, zero-padded and mixed-case coin types", () => {
    expect(normalizeCoinType("0x2::sui::USDC")).toBe(`${FULL_ADDRESS}::sui::usdc`);
    expect(normalizeCoinType(`${FULL_ADDRESS}::sui::usdc`)).toBe(`${FULL_ADDRESS}::sui::usdc`);
    expect(normalizeCoinType(`0x${"0".repeat(70)}2::SUI::usdc`)).toBe(
      `${FULL_ADDRESS}::sui::usdc`,
    );
  });

  it("treats the short and padded address forms as equal", () => {
    expect(normalizeCoinType("0x2::sui::USDC")).toBe(normalizeCoinType(`${FULL_ADDRESS}::sui::usdc`));
  });
});
