import { describe, expect, it } from "vitest";

import { canonicalJson, commitmentHash, sha256Hex } from "@/lib/canonical";

describe("canonicalJson", () => {
  it("sorts object keys and removes insignificant whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order while normalising members", () => {
    expect(canonicalJson([{ z: 1, a: 2 }, "x", true, null])).toBe('[{"a":2,"z":1},"x",true,null]');
  });

  it("drops undefined object members but rejects undefined array members", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(() => canonicalJson([undefined])).toThrow();
  });

  it("rejects values JSON cannot represent deterministically", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
  });
});

describe("sha256Hex", () => {
  it("matches the standard SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("commitmentHash", () => {
  it("is stable across key insertion order", () => {
    expect(commitmentHash({ selection: "Arsenal", odds: 2 })).toBe(
      commitmentHash({ odds: 2, selection: "Arsenal" }),
    );
  });

  it("changes when a committed field changes", () => {
    const base = { selection: "Arsenal", odds: 2, stakeUnits: 10 };
    expect(commitmentHash(base)).not.toBe(commitmentHash({ ...base, odds: 2.01 }));
  });
});
