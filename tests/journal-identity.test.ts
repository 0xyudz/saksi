import { describe, expect, it } from "vitest";

import {
  isJournalRef,
  isLegacyRef,
  isWalletRef,
  normalizeWalletRef,
  recoveryLookupKey,
  recoveryNamespace,
  walletNamespace,
} from "@/lib/journal-identity";
import { generateRecoveryCode } from "@/lib/recovery-code";

const WALLET = "0xe47cc1da1a36461dbfbc2431b36b8579403d105d8d2a6fe05c442071905d8900";
const LEGACY = "1240e27d-494c-4327-8454-abe39e16890b";
const PREFIX = "saksi";

describe("journal refs", () => {
  it("accepts a canonical address and a legacy uuid, and nothing else", () => {
    expect(isWalletRef(WALLET)).toBe(true);
    expect(isLegacyRef(LEGACY)).toBe(true);
    expect(isJournalRef(WALLET)).toBe(true);
    expect(isJournalRef(LEGACY)).toBe(true);

    expect(isJournalRef("saksi_dev")).toBe(false);
    expect(isJournalRef("")).toBe(false);
    expect(isJournalRef("0xNOTHEX")).toBe(false);
  });

  it("normalises a short Sui address to the canonical 32-byte form", () => {
    // Sui accepts `0x2`, so the same wallet must not produce two namespaces.
    expect(normalizeWalletRef("0x2")).toBe(`0x${"0".repeat(63)}2`);
    expect(normalizeWalletRef("0xAbC")).toBe(`0x${"0".repeat(61)}abc`);
    expect(normalizeWalletRef(`  ${WALLET.toUpperCase().replace("0X", "0x")}  `)).toBe(WALLET);
  });

  it("rejects an address that is not hex or has no prefix", () => {
    expect(() => normalizeWalletRef("e47cc1da")).toThrow(/must start with 0x/);
    expect(() => normalizeWalletRef("0xzz")).toThrow(/hex characters/);
    expect(() => normalizeWalletRef(`0x${"a".repeat(65)}`)).toThrow(/hex characters/);
  });

  it("derives the same normalised ref from every spelling of one address", () => {
    const short = "0xe47cc1da";
    const padded = `0x${"0".repeat(56)}e47cc1da`;
    expect(normalizeWalletRef(short)).toBe(normalizeWalletRef(padded));
  });
});

describe("recovery lookup", () => {
  it("is a stable, deterministic key for one code", () => {
    const code = generateRecoveryCode();
    expect(recoveryLookupKey(code)).toBe(recoveryLookupKey(code));
    expect(recoveryLookupKey(code)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("ignores case and surrounding whitespace, so a re-typed code still works", () => {
    const code = generateRecoveryCode();
    expect(recoveryLookupKey(`  ${code.toLowerCase()}  `)).toBe(recoveryLookupKey(code));
  });

  it("differs for different codes", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
    expect(recoveryLookupKey(a)).not.toBe(recoveryLookupKey(b));
  });

  it("names a namespace under the deployment prefix", () => {
    const code = generateRecoveryCode();
    expect(recoveryNamespace(PREFIX, code)).toBe(`${PREFIX}:recovery:${recoveryLookupKey(code)}`);
  });

  it("does not leak the code into the namespace name", () => {
    const code = generateRecoveryCode();
    const namespace = recoveryNamespace(PREFIX, code);
    const symbols = code.replace(/[^A-Z2-9]/g, "");
    expect(namespace.toUpperCase()).not.toContain(symbols);
  });
});

describe("wallet namespace", () => {
  it("is keyed by the wallet, so login is an exact lookup rather than a similarity search", () => {
    expect(walletNamespace(PREFIX, WALLET)).toBe(`${PREFIX}:wallet:${WALLET}`);
  });

  it("keeps identity separate from journal data, so legacy refs stay readable where they are", () => {
    const identity = walletNamespace(PREFIX, WALLET);
    const data = `${PREFIX}:${LEGACY}`;
    expect(identity).not.toBe(data);
    expect(identity.startsWith(`${PREFIX}:wallet:`)).toBe(true);
  });
});
