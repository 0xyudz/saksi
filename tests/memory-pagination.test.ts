import { describe, expect, it } from "vitest";

import { nextListStep } from "@/integrations/walrus-memory/client";

/**
 * The stale-cursor rule for `listMemories()`.
 *
 * The official Walrus Memory docs describe `must_resync` as "cursor too old: restart without
 * one". Ignoring it returns a short page that looks complete, which is worse than an error:
 * every count derived from it is quietly wrong. These tests pin the restart, and the bound that
 * stops it from looping if the relayer keeps rejecting a fresh walk.
 */
describe("nextListStep", () => {
  it("advances normally when the relayer is happy", () => {
    const step = nextListStep({
      mustResync: false,
      cursor: "c1",
      alreadyResynced: false,
      nextCursor: "c2",
      hasMore: true,
    });

    expect(step).toEqual({ cursor: "c2", hasMore: true, resynced: false, stalled: false });
  });

  it("ends the walk when the relayer reports no more pages", () => {
    const step = nextListStep({
      mustResync: false,
      cursor: "c2",
      alreadyResynced: false,
      nextCursor: null,
      hasMore: false,
    });

    expect(step.cursor).toBeUndefined();
    expect(step.hasMore).toBe(false);
  });

  it("restarts without a cursor when the cursor went stale", () => {
    const step = nextListStep({
      mustResync: true,
      cursor: "stale",
      alreadyResynced: false,
      nextCursor: null,
      hasMore: false,
    });

    expect(step).toEqual({ cursor: undefined, hasMore: true, resynced: true, stalled: false });
  });

  it("does not restart twice, so a hostile relayer cannot cause a loop", () => {
    const step = nextListStep({
      mustResync: true,
      cursor: "stale-again",
      alreadyResynced: true,
      nextCursor: null,
      hasMore: false,
    });

    expect(step.hasMore).toBe(false);
    expect(step.stalled).toBe(true);
  });

  it("stalls rather than restarting when the very first page is rejected", () => {
    // No cursor was ever issued, so there is nothing to reset; retrying would repeat the same
    // request forever.
    const step = nextListStep({
      mustResync: true,
      cursor: undefined,
      alreadyResynced: false,
      nextCursor: null,
      hasMore: false,
    });

    expect(step.hasMore).toBe(false);
    expect(step.stalled).toBe(true);
  });
});
