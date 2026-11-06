import { describe, expect, it } from "vitest";

import { relayerUsable } from "@/server/data/memory";

/**
 * Whether a relayer that answered `health()` is actually usable.
 *
 * The failure this guards against is specific: a relayer can serve reads while refusing
 * writes. In Saksi a pick is sealed only if its memory write succeeds, so that state fails
 * every sealing attempt while a read-only health check keeps reporting "ok". These tests pin
 * that an explicit `write_ready: false` degrades the check, and that an absent field does not.
 */
describe("relayerUsable", () => {
  it("is usable when the relayer reports writes are ready", () => {
    expect(relayerUsable({ reachable: true, writeReady: true })).toEqual({
      ok: true,
      reason: "ok",
    });
  });

  it("is not usable when the relayer explicitly refuses writes", () => {
    expect(relayerUsable({ reachable: true, writeReady: false })).toEqual({
      ok: false,
      reason: "writes_refused",
    });
  });

  it("is usable when the relayer does not report write state at all", () => {
    // An older relayer omits the field. Absence is not evidence of a fault, and treating it
    // as one would mark a working deployment as degraded.
    expect(relayerUsable({ reachable: true, writeReady: null })).toEqual({
      ok: true,
      reason: "ok",
    });
  });

  it("is not usable when the relayer could not be reached", () => {
    expect(relayerUsable({ reachable: false, writeReady: null })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("prefers the unreachable reason over write state", () => {
    // Unreachable dominates: there is no write state to report, and blaming writes would
    // misdirect whoever reads the health output.
    expect(relayerUsable({ reachable: false, writeReady: true }).reason).toBe("unreachable");
  });
});
