import { describe, expect, it } from "vitest";

import { providerStatusError } from "@/integrations/signals/provider";

describe("signal provider status mapping", () => {
  it("treats a successful response as no error", () => {
    expect(providerStatusError(200, "demo-1")).toBeNull();
    expect(providerStatusError(204, "demo-1")).toBeNull();
  });

  it("reports an unknown external id as NOT_FOUND, not as a provider outage", () => {
    const error = providerStatusError(404, "does-not-exist");
    expect(error?.code).toBe("NOT_FOUND");
    expect(error?.httpStatus).toBe(404);
    expect(error?.message).toContain("does-not-exist");
    expect(error?.retryable).toBe(false);
  });

  it("reports rejected credentials as a configuration problem", () => {
    for (const status of [401, 403]) {
      const error = providerStatusError(status, "demo-1");
      expect(error?.code).toBe("SERVICE_UNAVAILABLE");
      expect(error?.message).toContain("credentials");
    }
  });

  it("reports other client errors as validation failures", () => {
    const error = providerStatusError(422, "demo-1");
    expect(error?.code).toBe("VALIDATION_FAILED");
    expect(error?.retryable).toBe(false);
  });

  it("retries only genuine server failures", () => {
    for (const status of [500, 502, 503]) {
      const error = providerStatusError(status, "demo-1");
      expect(error?.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(error?.retryable).toBe(true);
    }
  });
});
