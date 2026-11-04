import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { assertProofAddress } from "@/server/wallet-auth";

const ADDRESS = "0x0dff2cd82bc7b0dd14346f2df2278846c81a00f4462097649d7a02ec4e8b0abf";
const OTHER = "0xe47cc1da0000000000000000000000000000000000000000000000000000d8900";

describe("assertProofAddress", () => {
  it("accepts the address the challenge was issued for", () => {
    expect(() => assertProofAddress(ADDRESS, ADDRESS)).not.toThrow();
  });

  it("accepts the same address written in different hex casing", () => {
    expect(() => assertProofAddress(ADDRESS, ADDRESS.toUpperCase())).not.toThrow();
  });

  it("rejects a signed proof that names a different address", () => {
    /*
     * This is the regression guard for the session-hijack bug: a valid signature over
     * wallet A must never authorise a request that supplies wallet B's address.
     */
    expect(() => assertProofAddress(ADDRESS, OTHER)).toThrow(AppError);
    try {
      assertProofAddress(ADDRESS, OTHER);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("UNAUTHORIZED");
    }
  });
});
