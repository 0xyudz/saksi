import { describe, expect, it } from "vitest";

import { isUuid } from "@/lib/ids";

/**
 * Detail pages pass route params straight into Postgres. Postgres raises a type error for
 * a malformed UUID, which used to surface as a 500 instead of the not-found UI.
 */
describe("isUuid", () => {
  it("accepts a canonical uuid", () => {
    expect(isUuid("e6ca716a-bdb5-4fce-b402-92f4efe3ff83")).toBe(true);
  });

  it("rejects a non-uuid path segment", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("rejects a truncated uuid", () => {
    expect(isUuid("e6ca716a-bdb5-4fce-b402")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects a uuid with an out-of-range version nibble", () => {
    expect(isUuid("e6ca716a-bdb5-9fce-b402-92f4efe3ff83")).toBe(false);
  });
});
