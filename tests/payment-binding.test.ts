import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import {
  assertSettlementMatchesSignal,
  normalizeResourceUrl,
} from "@/server/scoring/payment-binding";

const SIGNAL_A = "11111111-1111-4111-8111-111111111111";
const SIGNAL_B = "22222222-2222-4222-8222-222222222222";

function rejection(run: () => void): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected the binding check to reject");
}

describe("settlement binding", () => {
  it("rejects a digest already recorded for another signal", () => {
    const error = rejection(() =>
      assertSettlementMatchesSignal({
        existingPayment: { signalId: SIGNAL_A, resource: null },
        requestedSignalId: SIGNAL_B,
      }),
    );

    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain("different signal");
  });

  it("rejects a resource that belongs to another signal", () => {
    const error = rejection(() =>
      assertSettlementMatchesSignal({
        existingPayment: {
          signalId: SIGNAL_B,
          resource: `https://saksi.example/api/signals/${SIGNAL_A}`,
        },
        requestedSignalId: SIGNAL_B,
        expectedResource: `https://saksi.example/api/signals/${SIGNAL_B}`,
      }),
    );

    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain("different x402 resource");
  });

  it("treats trailing slashes, query strings and host case as the same resource", () => {
    expect(() =>
      assertSettlementMatchesSignal({
        existingPayment: {
          signalId: SIGNAL_A,
          resource: `HTTPS://SAKSI.EXAMPLE/api/signals/${SIGNAL_A}/?utm=old#fragment`,
        },
        requestedSignalId: SIGNAL_A,
        expectedResource: `https://saksi.example/api/signals/${SIGNAL_A}`,
      }),
    ).not.toThrow();
  });

  it("normalizes the URL deterministically", () => {
    expect(
      normalizeResourceUrl(
        `https://SAKSI.example/api/signals/${SIGNAL_A}/?a=1&b=2#top`,
      ),
    ).toBe(`https://saksi.example/api/signals/${SIGNAL_A}`);
  });

  it("lets a legacy null resource pass when the signal id matches", () => {
    expect(() =>
      assertSettlementMatchesSignal({
        existingPayment: { signalId: SIGNAL_A, resource: null },
        requestedSignalId: SIGNAL_A,
        expectedResource: `https://saksi.example/api/signals/${SIGNAL_A}`,
      }),
    ).not.toThrow();
  });

  it("accepts the exact same signal and resource", () => {
    expect(() =>
      assertSettlementMatchesSignal({
        existingPayment: {
          signalId: SIGNAL_A,
          resource: `https://saksi.example/api/signals/${SIGNAL_A}`,
        },
        requestedSignalId: SIGNAL_A,
        expectedResource: `https://saksi.example/api/signals/${SIGNAL_A}`,
      }),
    ).not.toThrow();
  });
});
