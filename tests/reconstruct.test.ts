import { describe, expect, it } from "vitest";

import type { RecalledMemoryHit } from "@/integrations/walrus-memory/client";
import { parseMemory } from "@/integrations/walrus-memory/schema";
import { analystsFromJournal, reconstructFromHits } from "@/server/scoring/reconstruct";

const ANALYST = "11111111-1111-4111-8111-111111111111";
const PICK_A = "22222222-2222-4222-8222-222222222222";
const PICK_B = "33333333-3333-4333-8333-333333333333";

function hit(text: string, distance = 0.5): RecalledMemoryHit {
  const memory = parseMemory(text);
  if (memory === null) throw new Error(`test fixture is not a valid memory: ${text}`);
  return { citation: { blobId: `blob-${Math.random()}`, text, distance }, memory };
}

const commitA = hit(
  `saksi:v1|type=pick_commit|id=${PICK_A}|analyst=${ANALYST}|market=Premier League|commitmentHash=${"a".repeat(64)}|committedAt=2026-11-01T10:00:00.000Z`,
);
const revealA = hit(
  `saksi:v1|type=pick_reveal|id=${PICK_A}|selection=Chelsea to win|odds=2.6|revealedAt=2026-11-01T12:00:00.000Z`,
);
const outcomeA = hit(
  `saksi:v1|type=outcome|pickId=${PICK_A}|result=loss|brier=0.400000|source=https://example.com/a|resolvedAt=2026-11-02T10:00:00.000Z`,
);

const commitB = hit(
  `saksi:v1|type=pick_commit|id=${PICK_B}|analyst=${ANALYST}|market=Premier League|commitmentHash=${"b".repeat(64)}|committedAt=2026-11-03T10:00:00.000Z`,
);
const revealB = hit(
  `saksi:v1|type=pick_reveal|id=${PICK_B}|selection=Arsenal to win|odds=3.1|revealedAt=2026-11-03T12:00:00.000Z`,
);
const outcomeB = hit(
  `saksi:v1|type=outcome|pickId=${PICK_B}|result=loss|brier=0.300000|source=https://example.com/b|resolvedAt=2026-11-04T10:00:00.000Z`,
);

describe("reconstructFromHits", () => {
  it("joins commit, reveal and outcome into one pick", () => {
    const journal = reconstructFromHits([commitA, revealA, outcomeA]);

    expect(journal.picks).toHaveLength(1);
    const pick = journal.picks[0];
    expect(pick?.pickId).toBe(PICK_A);
    expect(pick?.analystId).toBe(ANALYST);
    expect(pick?.selection).toBe("Chelsea to win");
    expect(pick?.odds).toBe(2.6);
    expect(pick?.result).toBe("loss");
    expect(pick?.brier).toBe(0.4);
  });

  it("reports the kinds it actually saw", () => {
    const journal = reconstructFromHits([commitA, revealA, outcomeA, commitB]);
    expect(journal.kinds).toEqual(["outcome", "pick_commit", "pick_reveal"]);
  });

  it("orders picks newest commitment first", () => {
    const journal = reconstructFromHits([commitA, revealA, commitB, revealB]);
    expect(journal.picks.map((pick) => pick.pickId)).toEqual([PICK_B, PICK_A]);
  });

  it("ignores a commit that carries no analyst, rather than inventing one", () => {
    // A pick_commit whose analyst id is not a uuid fails the schema, so it never parses.
    const brokenText = `saksi:v1|type=pick_commit|id=${PICK_A}|analyst=not-a-uuid|market=M|commitmentHash=${"a".repeat(64)}|committedAt=2026-11-01T10:00:00.000Z`;
    const broken: RecalledMemoryHit = {
      citation: { blobId: "blob-broken", text: brokenText, distance: 0.4 },
      memory: parseMemory(brokenText),
    };
    expect(broken.memory).toBeNull();
    const journal = reconstructFromHits([broken]);
    expect(journal.picks).toHaveLength(0);
  });

  it("counts an unparseable memory as recalled but not as evidence", () => {
    const stray: RecalledMemoryHit = {
      citation: { blobId: "blob-stray", text: "not a saksi record", distance: 0.9 },
      memory: null,
    };
    const journal = reconstructFromHits([stray, commitA]);
    expect(journal.recalled).toBe(2);
    expect(journal.picks).toHaveLength(1);
  });

  it("marks the result as possibly truncated at the recall cap", () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      hit(
        `saksi:v1|type=pick_reveal|id=${PICK_A}|selection=S|odds=2|revealedAt=2026-11-01T12:00:0${index % 10}.000Z`,
        index / 1000,
      ),
    );
    expect(reconstructFromHits(many).possiblyTruncated).toBe(true);
    expect(reconstructFromHits([commitA]).possiblyTruncated).toBe(false);
  });
});

describe("analystsFromJournal", () => {
  it("derives two underdog losses into a bias pattern without reading Postgres", () => {
    const journal = reconstructFromHits([commitA, revealA, outcomeA, commitB, revealB, outcomeB]);
    const analysts = analystsFromJournal(journal);

    expect(analysts).toHaveLength(1);
    const entry = analysts[0];
    expect(entry?.credibility.resolved).toBe(2);
    expect(entry?.credibility.wins).toBe(0);
    expect(entry?.credibility.losses).toBe(2);
    expect(entry?.bias).toHaveLength(1);
    expect(entry?.bias[0]?.pattern).toContain("underdog");
    expect(entry?.bias[0]?.evidence).toBe(2);
  });

  it("never claims an outcome is provider-verified, because memory carries no such flag", () => {
    const journal = reconstructFromHits([commitA, revealA, outcomeA]);
    const entry = analystsFromJournal(journal)[0];
    expect(entry?.credibility.verifiedResolved).toBe(0);
    expect(entry?.credibility.hasVerifiedEvidence).toBe(false);
  });

  it("ignores a pick that has not been resolved", () => {
    const journal = reconstructFromHits([commitA, revealA]);
    const entry = analystsFromJournal(journal)[0];
    expect(entry?.credibility.resolved).toBe(0);
    expect(entry?.bias).toHaveLength(0);
  });
});
