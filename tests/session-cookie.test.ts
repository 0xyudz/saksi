import { describe, expect, it } from "vitest";

import { signSession, verifySession } from "@/lib/session-cookie";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const OTHER_SECRET = "another-test-secret-with-32-characters!!";

describe("signed session cookies", () => {
  it("round-trips the user id", () => {
    const token = signSession(USER_ID, SECRET);

    expect(token).not.toBe(USER_ID);
    expect(verifySession(token, SECRET)).toBe(USER_ID);
  });

  it("rejects a modified signature", () => {
    const token = signSession(USER_ID, SECRET);
    const separator = token.lastIndexOf(".");
    const signature = token.slice(separator + 1);
    const replacement = signature.startsWith("A") ? "B" : "A";
    const tampered = `${token.slice(0, separator + 1)}${replacement}${signature.slice(1)}`;

    expect(verifySession(tampered, SECRET)).toBeNull();
  });

  it("rejects a modified user id", () => {
    const token = signSession(USER_ID, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);

    expect(verifySession(`${OTHER_ID}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects an empty or legacy unsigned cookie", () => {
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession(USER_ID, SECRET)).toBeNull();
    expect(verifySession(`${USER_ID}.`, SECRET)).toBeNull();
  });

  it("rejects the same token under a different secret", () => {
    const token = signSession(USER_ID, SECRET);

    expect(verifySession(token, OTHER_SECRET)).toBeNull();
  });
});
