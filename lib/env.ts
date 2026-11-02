import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { z } from "zod";

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
    X402_PAY_TO_ADDRESS: suiAddress,
    X402_PRICE: price.default("$0.01"),
    /** Only `pnpm verify:x402` needs the key; the browser signs purchases with the user's wallet. */
    X402_CLIENT_PRIVATE_KEY: nonEmpty.optional(),
    X402_TEST_SIGNAL_ID: z.string().uuid().optional(),

    SIGNAL_PROVIDER_API_URL: httpUrl.optional(),
    SIGNAL_PROVIDER_API_KEY: nonEmpty.optional(),
    /**
     * Comma-separated journal handles allowed to ingest provider signals. Ingest spends the
     * operator's provider quota and writes to the shared signal catalogue, so it is not a
     * feature for every visitor. Empty or unset disables ingestion entirely.
     */
    OPERATOR_HANDLES: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((handle) => handle.trim().toLowerCase())
          .filter((handle) => handle.length > 0),
      ),

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
    const hasUrl = value.SIGNAL_PROVIDER_API_URL !== undefined;
    const hasKey = value.SIGNAL_PROVIDER_API_KEY !== undefined;
    if (hasUrl !== hasKey) {
      ctx.addIssue({
        code: "custom",
        path: hasUrl ? ["SIGNAL_PROVIDER_API_KEY"] : ["SIGNAL_PROVIDER_API_URL"],
        message: "SIGNAL_PROVIDER_API_URL and SIGNAL_PROVIDER_API_KEY must be set together",
      });
    }

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
  });

export type Env = z.infer<typeof envSchema>;

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
