import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { z } from "zod";

import { GASLESS_MIN_ATOMIC } from "./config";
import { formatAtomic, parsePriceToAtomic } from "./price";

const nonEmpty = z.string().min(1);
const httpUrl = z.string().url();

const suiAddress = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hex Sui address");

const price = z
  .string()
  .regex(/^\$?\d+(\.\d{1,6})?$/, 'expected a USD price such as "$0.01" or an atomic amount');

export const suiNetworkSchema = z.enum(["sui:mainnet", "sui:testnet"]);
export type SuiNetwork = z.infer<typeof suiNetworkSchema>;

export const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

const envSchema = z
  .object({
    DATABASE_URL: httpUrl,

    WALRUS_MEMORY_PRIVATE_KEY: nonEmpty,
    WALRUS_MEMORY_ACCOUNT_ID: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "expected the MemWalAccount object id"),
    WALRUS_MEMORY_RELAYER_URL: httpUrl,
    WALRUS_MEMORY_NAMESPACE_PREFIX: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase namespace prefix"),

    TATUM_API_KEY: nonEmpty,
    TATUM_SUI_RPC_URL: httpUrl,
    SUI_NETWORK: suiNetworkSchema,
    SUI_USDC_COIN_TYPE: nonEmpty,
    AGENT_SUI_ADDRESS: suiAddress,
    TATUM_VERIFY_DIGEST: nonEmpty.optional(),

    X402_FACILITATOR_URL: httpUrl,
    /**
     * The platform's own address. Two distinct jobs: it receives the listing fee a seller
     * pays to publish, and it is the fallback recipient for catalogue signals that have no
     * seller. It is never an intermediary for a sale — buyers pay the seller directly.
     */
    X402_PAY_TO_ADDRESS: suiAddress,
    X402_PRICE: price.default("$0.01"),
    /**
     * What a seller pays to publish one signal. Charged as its own x402 settlement before
     * the listing becomes visible, which is what makes the fee enforceable without Saksi
     * holding anyone's money. Must be at least the Sui gasless minimum (0.01 USDC) or the
     * settlement cannot be sponsored.
     */
    X402_LISTING_FEE: price.default("$0.02"),
    /** Only `pnpm verify:x402` needs the key; the browser signs purchases with the user's wallet. */
    X402_CLIENT_PRIVATE_KEY: nonEmpty.optional(),
    X402_TEST_SIGNAL_ID: z.string().uuid().optional(),

    /**
     * Base URL of the independent results provider used to verify outcomes. Saksi reads
     * final scores from here and refuses to mark a pick oracle-verified when the provider
     * disagrees, so the value of a seller's record does not rest on their own claim.
     */
    ORACLE_ESPN_BASE_URL: httpUrl.default("https://site.api.espn.com/apis/site/v2/sports"),
    /** Disables oracle verification entirely, leaving every outcome self-attested. */
    ORACLE_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),

    APP_BASE_URL: httpUrl,
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    LOG_LEVEL: logLevelSchema.default("info"),
    WALRUS_RECALL_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    /**
     * Per-instance Postgres pool. Serverless platforms freeze and clone instances, so the
     * local default of 10 can exhaust a small Postgres plan; deployments set this lower.
     */
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  })
  .superRefine((value, ctx) => {
    const rpcHost = new URL(value.TATUM_SUI_RPC_URL).hostname.toLowerCase();
    const expectedNetwork = value.SUI_NETWORK === "sui:mainnet" ? "mainnet" : "testnet";
    if (!rpcHost.includes(expectedNetwork)) {
      ctx.addIssue({
        code: "custom",
        path: ["TATUM_SUI_RPC_URL"],
        message: `Tatum RPC host must contain "${expectedNetwork}" when SUI_NETWORK is ${value.SUI_NETWORK}`,
      });
    }

    if (value.X402_CLIENT_PRIVATE_KEY !== undefined) {
      try {
        const derived = Ed25519Keypair.fromSecretKey(value.X402_CLIENT_PRIVATE_KEY).toSuiAddress();
        if (derived.toLowerCase() !== value.AGENT_SUI_ADDRESS.toLowerCase()) {
          ctx.addIssue({
            code: "custom",
            path: ["AGENT_SUI_ADDRESS"],
            message:
              "AGENT_SUI_ADDRESS does not match the key derived from X402_CLIENT_PRIVATE_KEY",
          });
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["X402_CLIENT_PRIVATE_KEY"],
          message: "X402_CLIENT_PRIVATE_KEY could not be parsed as an Ed25519 key",
        });
      }
    }

    /**
     * Sui only sponsors gas for settlements at or above this threshold. A price below it
     * would build a sponsored transaction the network rejects with `InsufficientGas`, so
     * the misconfiguration is caught at startup rather than by the first buyer or seller
     * who tries to settle.
     */
    for (const [field, raw] of [
      ["X402_PRICE", value.X402_PRICE],
      ["X402_LISTING_FEE", value.X402_LISTING_FEE],
    ] as const) {
      const atomic = parsePriceToAtomic(raw);
      if (atomic < GASLESS_MIN_ATOMIC) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `must be at least ${formatAtomic(GASLESS_MIN_ATOMIC)} USDC, the Sui gasless minimum`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** The listing fee in atomic units, derived from the configured USD string. */
export function listingFeeAtomic(env: Env = getEnv()): bigint {
  return parsePriceToAtomic(env.X402_LISTING_FEE);
}

/** The catalogue fallback price in atomic units. */
export function signalPriceAtomic(env: Env = getEnv()): bigint {
  return parsePriceToAtomic(env.X402_PRICE);
}

let cached: Env | undefined;

/**
 * Validation happens lazily so `next build` can compile routes without production
 * credentials, while every runtime entry point (instrumentation, route, script) still
 * fails fast before touching Postgres, Walrus or Tatum.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${fields}`);
  }

  cached = parsed.data;
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}
