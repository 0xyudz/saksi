import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it } from "vitest";

import { buildChallengeMessage } from "@/server/wallet-auth";
import { verifyPersonalMessageSignature } from "@/server/wallet-signature";

const MESSAGE = buildChallengeMessage({
  address: "0x0dff2cd82bc7b0dd14346f2df2278846c81a00f4462097649d7a02ec4e8b0abf",
  purpose: "login",
  subject: null,
  nonce: "32d62aafc79d1d3e0c602ebb52cd1043",
  issuedAt: "2026-11-03T20:47:08.472Z",
});

const ADDRESS = "0x0dff2cd82bc7b0dd14346f2df2278846c81a00f4462097649d7a02ec4e8b0abf";

describe("buildChallengeMessage", () => {
  it("names the action so a login signature cannot be reused for a bind", () => {
    expect(MESSAGE).toContain("Action: login");
    expect(MESSAGE).toContain(`Address: ${ADDRESS}`);
    expect(MESSAGE).toContain("Nonce: 32d62aafc79d1d3e0c602ebb52cd1043");
  });

  it("states that the signature authorises no payment", () => {
    expect(MESSAGE).toContain("authorises no payment");
  });

  it("shows the target only when there is one", () => {
    const withSubject = buildChallengeMessage({
      address: ADDRESS,
      purpose: "claim",
      subject: "saksi_reader",
      nonce: "abc",
      issuedAt: "2026-11-03T00:00:00.000Z",
    });
    expect(withSubject).toContain("Target: saksi_reader");
    expect(MESSAGE).toContain("Target: (this wallet)");
  });
});

describe("verifyPersonalMessageSignature", () => {
  it("accepts a signature from the named address", async () => {
    const keypair = Ed25519Keypair.generate();
    const signed = await keypair.signPersonalMessage(new TextEncoder().encode(MESSAGE));

    await expect(
      verifyPersonalMessageSignature({
        message: MESSAGE,
        signature: signed.signature,
        address: keypair.toSuiAddress(),
      }),
    ).resolves.toBe(true);
  });

  it("rejects a signature from a different address", async () => {
    const keypair = Ed25519Keypair.generate();
    const signed = await keypair.signPersonalMessage(new TextEncoder().encode(MESSAGE));

    await expect(
      verifyPersonalMessageSignature({
        message: MESSAGE,
        signature: signed.signature,
        address: Ed25519Keypair.generate().toSuiAddress(),
      }),
    ).resolves.toBe(false);
  });

  it("rejects a signature over a different message", async () => {
    const keypair = Ed25519Keypair.generate();
    const signed = await keypair.signPersonalMessage(new TextEncoder().encode("something else"));

    await expect(
      verifyPersonalMessageSignature({
        message: MESSAGE,
        signature: signed.signature,
        address: keypair.toSuiAddress(),
      }),
    ).resolves.toBe(false);
  });

  it("returns false for a malformed signature instead of throwing", async () => {
    // Regression: `isValidPersonalMessageSignature` throws a RangeError for a short
    // signature, which previously surfaced as a 500 rather than a 401.
    const shortSignature = Buffer.from(new Uint8Array(64)).toString("base64");

    await expect(
      verifyPersonalMessageSignature({
        message: MESSAGE,
        signature: shortSignature,
        address: ADDRESS,
      }),
    ).resolves.toBe(false);
  });

  it("returns false for an empty or unparseable signature", async () => {
    for (const signature of ["", "not-base64!!", "AAAA"]) {
      await expect(
        verifyPersonalMessageSignature({ message: MESSAGE, signature, address: ADDRESS }),
      ).resolves.toBe(false);
    }
  });

  it("returns false for a malformed address instead of throwing", async () => {
    await expect(
      verifyPersonalMessageSignature({
        message: MESSAGE,
        signature: "AAAA",
        address: "not-an-address",
      }),
    ).resolves.toBe(false);
  });
});
