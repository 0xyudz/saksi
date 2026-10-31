import type { SuiNetwork } from "./env";

/**
 * Protocol-level constants live here only. Everything deployment-specific is read
 * through `lib/env.ts`; nothing below contains a secret, address or price.
 */

export const APP_NAME = "Saksi";
export const APP_TAGLINE = "The prediction journal that cannot lie.";

/** Prefix of the deterministic Walrus Memory text format (see integrations/walrus-memory/schema.ts). */
export const MEMORY_FORMAT_PREFIX = "saksi:v1";

/** Header used to correlate structured logs with a response. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Session cookie holding the local user id. */
export const SESSION_COOKIE = "saksi_user";

export const USDC_DECIMALS = 6;

/**
 * Decimal odds at or above this value are treated as an underdog pick by the bias
 * model. Product rule, not an environment concern.
 */
export const UNDERDOG_ODDS_THRESHOLD = 2.5;

/** Minimum sample before a bias warning is emitted to the recommender. */
export const BIAS_MIN_EVIDENCE = 2;

/** Sui transaction digests are base58-encoded 32-byte hashes. */
export const SUI_DIGEST_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export const TATUM_REQUEST_TIMEOUT_MS = 15_000;
export const TATUM_MAX_ATTEMPTS = 3;
export const TATUM_RETRY_BASE_DELAY_MS = 400;

/** Explorer hosts for Sui. Protocol constants, not deploy-specific. */
const EXPLORERS: Record<SuiNetwork, string> = {
  "sui:mainnet": "https://suivision.xyz",
  "sui:testnet": "https://testnet.suivision.xyz",
};

export function explorerTxUrl(network: SuiNetwork, digest: string): string {
  return `${EXPLORERS[network]}/txblock/${encodeURIComponent(digest)}`;
}

export function explorerAddressUrl(network: SuiNetwork, address: string): string {
  return `${EXPLORERS[network]}/account/${encodeURIComponent(address)}`;
}

/** Wilson score z-value for a 95% interval. */
export const WILSON_Z = 1.96;

/** Recency half-life for the credibility model, in days. */
export const CREDIBILITY_HALF_LIFE_DAYS = 90;
