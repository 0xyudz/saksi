import { describe, expect, it } from "vitest";

import {
  buildBiasMemory,
  buildOutcomeMemory,
  buildPaymentMemory,
  buildPickCommitMemory,
  buildPickMemory,
  buildPickRevealMemory,
  buildPreferenceMemory,
  buildSourceRoiMemory,
  memoryKind,
  namespaceFor,
  parseMemory,
} from "@/integrations/walrus-memory/schema";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ANALYST_ID = "22222222-2222-4222-8222-222222222222";
const PICK_ID = "33333333-3333-4333-8333-333333333333";
const RESOLVED_AT = "2026-10-28T12:00:00.000Z";
const COMMITMENT_HASH = "a".repeat(64);

describe("memory format v1", () => {
  it("round-trips a pick memory", () => {
    const built = buildPickMemory({
      id: PICK_ID,
      analyst: ANALYST_ID,
      market: "Premier League · Match winner",
      selection: "Arsenal to win",
      odds: 2.1,
      committedAt: RESOLVED_AT,
    });

    expect(built.kind).toBe("pick");
    expect(built.text.startsWith("saksi:v1|type=pick|")).toBe(true);

    const parsed = parseMemory(built.text);
    expect(parsed?.kind).toBe("pick");
    if (parsed?.kind !== "pick") throw new Error("expected a pick");
    expect(parsed.selection).toBe("Arsenal to win");
    expect(parsed.odds).toBe(2.1);
  });

  it("escapes delimiters and newlines inside values", () => {
    const built = buildPickMemory({
      id: PICK_ID,
      analyst: ANALYST_ID,
      market: "A|B% C\nD",
      selection: "line 1\r\nline 2",
      odds: 1.5,
      committedAt: RESOLVED_AT,
    });

    expect(built.text).not.toContain("\n");
    expect(built.text.split("|")).toHaveLength(8);

    const parsed = parseMemory(built.text);
    expect(parsed?.kind).toBe("pick");
    if (parsed?.kind !== "pick") throw new Error("expected a pick");
    expect(parsed.market).toBe("A|B% C D");
    expect(parsed.selection).toBe("line 1  line 2");
  });

  it("round-trips every supported kind", () => {
    const built = [
      buildOutcomeMemory({
        pickId: PICK_ID,
        result: "win",
        brier: 0.04,
        source: "https://example.org/result",
        resolvedAt: RESOLVED_AT,
      }),
      buildBiasMemory({
        analyst: ANALYST_ID,
        pattern: "3 of 4 underdog picks lost",
        evidence: 3,
        confidence: 0.7,
      }),
      buildSourceRoiMemory({
        provider: "provider-a",
        spendAtomic: "25000",
        correct: 3,
        wrong: 1,
        note: "net positive",
      }),
      buildPreferenceMemory({ userId: USER_ID, statement: "Avoid low-odds parlays" }),
      buildPaymentMemory({
        digest: "4Y8f3nJ7hK2mP9qR6sT1vW5xZ8aB3cD7eF2gH6jK9mN4",
        provider: "provider-a",
        amountAtomic: "10000",
        network: "sui:testnet",
      }),
    ];

    for (const memory of built) {
      const parsed = parseMemory(memory.text);
      expect(parsed?.kind).toBe(memory.kind);
      expect(memoryKind(memory.text)).toBe(memory.kind);
    }
  });

  it("rejects malformed records instead of guessing", () => {
    expect(parseMemory("type=pick|id=x")).toBeNull();
    expect(parseMemory("saksi:v2|type=pick")).toBeNull();
    expect(parseMemory("saksi:v1|type=unknown|id=x")).toBeNull();
    expect(parseMemory("saksi:v1|type=pick|id=x|id=y")).toBeNull();
    expect(
      parseMemory(
        `saksi:v1|type=pick|id=${PICK_ID}|analyst=${ANALYST_ID}|market=m|selection=s|odds=1|committedAt=${RESOLVED_AT}`,
      ),
    ).toBeNull();
    expect(
      parseMemory(
        `saksi:v1|type=pick|id=${PICK_ID}|analyst=${ANALYST_ID}|market=m|selection=s|odds=2|committedAt=not-a-date`,
      ),
    ).toBeNull();
  });

  it("uses the configured prefix in the namespace", () => {
    expect(namespaceFor("saksi-test", USER_ID)).toBe(`saksi-test:${USER_ID}`);
  });

  it("never writes selection or odds into the sealed commit memory", () => {
    const built = buildPickCommitMemory({
      id: PICK_ID,
      analyst: ANALYST_ID,
      market: "Premier League · Match winner",
      commitmentHash: COMMITMENT_HASH,
      committedAt: RESOLVED_AT,
    });

    expect(built.kind).toBe("pick_commit");
    expect(built.text).not.toContain("selection=");
    expect(built.text).not.toContain("odds=");
    expect(built.text).toContain(`commitmentHash=${COMMITMENT_HASH}`);

    const parsed = parseMemory(built.text);
    expect(parsed?.kind).toBe("pick_commit");
    if (parsed?.kind !== "pick_commit") throw new Error("expected a pick_commit");
    expect(parsed.commitmentHash).toBe(COMMITMENT_HASH);
  });

  it("round-trips a reveal memory with the selection and odds", () => {
    const built = buildPickRevealMemory({
      id: PICK_ID,
      selection: "Arsenal to win",
      odds: 2.1,
      revealedAt: RESOLVED_AT,
    });

    expect(built.kind).toBe("pick_reveal");

    const parsed = parseMemory(built.text);
    expect(parsed?.kind).toBe("pick_reveal");
    if (parsed?.kind !== "pick_reveal") throw new Error("expected a pick_reveal");
    expect(parsed.selection).toBe("Arsenal to win");
    expect(parsed.odds).toBe(2.1);
    expect(memoryKind(built.text)).toBe("pick_reveal");
  });

  it("still parses legacy pick memories for reads", () => {
    const legacy = buildPickMemory({
      id: PICK_ID,
      analyst: ANALYST_ID,
      market: "Legacy market",
      selection: "Legacy selection",
      odds: 1.8,
      committedAt: RESOLVED_AT,
    });

    const parsed = parseMemory(legacy.text);
    expect(parsed?.kind).toBe("pick");
    if (parsed?.kind !== "pick") throw new Error("expected a legacy pick");
    expect(parsed.selection).toBe("Legacy selection");
  });
});
