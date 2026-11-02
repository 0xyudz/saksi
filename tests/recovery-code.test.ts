import { describe, expect, it } from "vitest";

import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from "@/lib/recovery-code";

describe("recovery code", () => {
  it("generates a 24 symbol code from the unambiguous alphabet", () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(24);
    // I, O, 0 and 1 are excluded so a code can be read aloud.
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{24}$/);
  });

  it("generates a different code every time", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(50);
  });

  it("normalises case, dashes and spaces so a pasted code still verifies", () => {
    const canonical = "ABCDEFGHJKLMNPQRSTUVWX";
    const pasted = "abcd-efgh jklm_npqr stuvwx";

    expect(normalizeRecoveryCode(pasted)).toBe(canonical);
    expect(formatRecoveryCode(canonical)).toBe("ABCD-EFGH-JKLM-NPQR-STUV-WX");
  });

  it("verifies the code it hashed", async () => {
    const code = generateRecoveryCode();
    const stored = await hashRecoveryCode(code);

    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain(code);
    await expect(verifyRecoveryCode(code, stored)).resolves.toBe(true);
  });

  it("accepts the formatted form of the same code", async () => {
    const code = generateRecoveryCode();
    const stored = await hashRecoveryCode(code);

    await expect(verifyRecoveryCode(formatRecoveryCode(code), stored)).resolves.toBe(true);
  });

  it("rejects a wrong code", async () => {
    const stored = await hashRecoveryCode(generateRecoveryCode());
    await expect(verifyRecoveryCode(generateRecoveryCode(), stored)).resolves.toBe(false);
  });

  it("rejects a code with the wrong length instead of hashing it", async () => {
    await expect(hashRecoveryCode("TOOSHORT")).rejects.toThrow(/24 symbols/);
  });

  it("never resumes a journal created before recovery existed", async () => {
    await expect(verifyRecoveryCode(generateRecoveryCode(), null)).resolves.toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    const code = generateRecoveryCode();
    for (const stored of ["", "plaintext", "scrypt$zz$yy", "bcrypt$00$00"]) {
      await expect(verifyRecoveryCode(code, stored)).resolves.toBe(false);
    }
  });

  it("uses a fresh salt so the same code hashes differently", async () => {
    const code = generateRecoveryCode();
    const first = await hashRecoveryCode(code);
    const second = await hashRecoveryCode(code);

    expect(first).not.toBe(second);
    await expect(verifyRecoveryCode(code, first)).resolves.toBe(true);
    await expect(verifyRecoveryCode(code, second)).resolves.toBe(true);
  });
});
