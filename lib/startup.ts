import { getEnv } from "./env";
import { getLogger } from "./logger";

/**
 * Runtime entry point used by `instrumentation.ts`. Validation is lazy and cached, but
 * this call happens before the first request so a missing credential stops the server
 * instead of producing a half-working journal.
 */
export function assertStartupEnvironment(): void {
  const env = getEnv();
  getLogger().info(
    {
      suiNetwork: env.SUI_NETWORK,
      signalProvider: env.SIGNAL_PROVIDER_API_URL === undefined ? "disabled" : "configured",
      recallLimit: env.WALRUS_RECALL_LIMIT,
    },
    "environment validated",
  );
}
