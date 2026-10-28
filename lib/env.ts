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
    X402_CLIENT_PRIVATE_KEY: nonEmpty,
    X402_TEST_SIGNAL_ID: z.string().uuid().optional(),

    SIGNAL_PROVIDER_API_URL: httpUrl.optional(),
    SIGNAL_PROVIDER_API_KEY: nonEmpty.optional(),

    APP_BASE_URL: httpUrl,
    LOG_LEVEL: logLevelSchema.default("info"),
    WALRUS_RECALL_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
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
