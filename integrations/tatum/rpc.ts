import { z } from "zod";

import {
  TATUM_MAX_ATTEMPTS,
  TATUM_REQUEST_TIMEOUT_MS,
  TATUM_RETRY_BASE_DELAY_MS,
  SUI_DIGEST_PATTERN,
} from "@/lib/config";
import type { JsonObject } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toJsonValue } from "@/lib/json";
import { errorForLog, getLogger } from "@/lib/logger";

const rpcEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

const effectsStatusSchema = z.object({
  status: z.string(),
  error: z.string().optional(),
});

const balanceChangeSchema = z.object({
  owner: z.union([
    z.object({ AddressOwner: z.string() }),
    z.object({ ObjectOwner: z.string() }),
    z.object({ Shared: z.object({ initial_shared_version: z.number() }) }).loose(),
    z.object({ Immutable: z.string() }),
  ]),
  coinType: z.string(),
  amount: z.string(),
});

export const suiTransactionBlockSchema = z
  .object({
    digest: z.string().regex(SUI_DIGEST_PATTERN),
    timestampMs: z.string().optional(),
    transaction: z
      .object({
        data: z.object({ sender: z.string() }).loose(),
      })
      .loose()
      .optional(),
    effects: z
      .object({
        status: effectsStatusSchema,
        gasUsed: z.unknown().optional(),
      })
      .loose()
      .optional(),
    balanceChanges: z.array(balanceChangeSchema).nullish(),
    events: z.array(z.unknown()).nullish(),
  })
  .loose();

export type SuiTransactionBlock = z.infer<typeof suiTransactionBlockSchema>;

export const suiBalanceSchema = z.object({
  coinType: z.string(),
  coinObjectCount: z.number(),
  totalBalance: z.string(),
  lockedBalance: z.record(z.string(), z.string()).optional(),
});

export type SuiBalance = z.infer<typeof suiBalanceSchema>;

export const suiEventsPageSchema = z
  .object({
    data: z.array(z.unknown()),
    nextCursor: z.string().nullish(),
    hasNextPage: z.boolean(),
  })
  .loose();

export const suiObjectSchema = z
  .object({
    data: z
      .object({
        objectId: z.string(),
        type: z.string().optional(),
        owner: z.unknown().optional(),
      })
      .loose()
      .nullish(),
    error: z.unknown().optional(),
  })
  .loose();

export interface RpcResult<T> {
  readonly result: T;
  readonly raw: JsonObject;
}

export interface TransactionBlockOptions {
  readonly showEffects: boolean;
  readonly showEvents: boolean;
  readonly showBalanceChanges?: boolean;
  readonly showInput?: boolean;
}

const MAX_RETRY_DELAY_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TatumSuiRpc {
  private readonly url: string;
  private readonly apiKey: string;
  private nextId = 1;

  constructor(options: { url: string; apiKey: string }) {
    this.url = options.url;
    this.apiKey = options.apiKey;
  }

  static fromEnv(): TatumSuiRpc {
    const env = getEnv();
    return new TatumSuiRpc({ url: env.TATUM_SUI_RPC_URL, apiKey: env.TATUM_API_KEY });
  }

  async request<T>(
    method: string,
    params: ReadonlyArray<unknown>,
    schema: z.ZodType<T>,
    options: { readonly nullMeansNotFound?: boolean } = {},
  ): Promise<RpcResult<T>> {
    let lastError: unknown;
    let lastRetryable = false;

    for (let attempt = 1; attempt <= TATUM_MAX_ATTEMPTS; attempt += 1) {
      const id = this.nextId;
      this.nextId += 1;
      lastRetryable = false;

      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          signal: AbortSignal.timeout(TATUM_REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Tatum RPC responded ${response.status}`);
          lastRetryable = response.status >= 500;
          if (attempt < TATUM_MAX_ATTEMPTS) {
            const backoff = Math.min(
              MAX_RETRY_DELAY_MS,
              TATUM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200),
            );
            await sleep(backoff);
            continue;
          }
          break;
        }

        const text = await response.text();
        if (!response.ok) {
          throw new AppError("UPSTREAM_UNAVAILABLE", `Tatum RPC responded ${response.status}.`, {
            cause: new Error(text.slice(0, 500)),
          });
        }

        let envelope: z.infer<typeof rpcEnvelopeSchema>;
        try {
          envelope = rpcEnvelopeSchema.parse(JSON.parse(text));
        } catch (error) {
          throw new AppError("UPSTREAM_UNAVAILABLE", "Tatum RPC returned an invalid envelope.", {
            cause: error,
          });
        }

        if (envelope.error) {
          throw new AppError(
            "UPSTREAM_UNAVAILABLE",
            `Tatum RPC error ${envelope.error.code}: ${envelope.error.message}`,
          );
        }

        if (options.nullMeansNotFound && envelope.result === null) {
          throw new AppError("PAYMENT_NOT_VERIFIED", "Transaction not found.");
        }

        const parsed = schema.safeParse(envelope.result);
        if (!parsed.success) {
          throw new AppError(
            "UPSTREAM_UNAVAILABLE",
            `Tatum RPC returned an unexpected ${method} payload.`,
            {
              cause: parsed.error,
            },
          );
        }

        return {
          result: parsed.data,
          raw: { method, result: toJsonValue(envelope.result) },
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        lastError = error;
        lastRetryable = true;
        if (attempt < TATUM_MAX_ATTEMPTS) {
          const backoff = Math.min(
            MAX_RETRY_DELAY_MS,
            TATUM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200),
          );
          await sleep(backoff);
          continue;
        }
      }
    }

    getLogger().error(
      { error: errorForLog(lastError), method },
      "Tatum RPC exhausted its retry budget",
    );
    throw new AppError("UPSTREAM_UNAVAILABLE", `Tatum RPC call ${method} failed.`, {
      cause: lastError,
      retryable: lastRetryable,
    });
  }

  async getLatestCheckpoint(): Promise<string> {
    const { result } = await this.request("sui_getLatestCheckpointSequenceNumber", [], z.string());
    return result;
  }

  async getTransactionBlock(
    digest: string,
    options: TransactionBlockOptions = { showEffects: true, showEvents: true },
  ): Promise<RpcResult<SuiTransactionBlock>> {
    if (!SUI_DIGEST_PATTERN.test(digest)) {
      throw new AppError("VALIDATION_FAILED", "Invalid Sui transaction digest.");
    }
    return this.request("sui_getTransactionBlock", [digest, options], suiTransactionBlockSchema, {
      nullMeansNotFound: true,
    });
  }

  async getBalance(owner: string, coinType: string): Promise<RpcResult<SuiBalance>> {
    return this.request("suix_getBalance", [owner, coinType], suiBalanceSchema);
  }

  async queryEvents(input: {
    query: Record<string, unknown>;
    cursor?: string;
    limit?: number;
    descending?: boolean;
  }): Promise<RpcResult<z.infer<typeof suiEventsPageSchema>>> {
    return this.request(
      "suix_queryEvents",
      [input.query, input.cursor ?? null, input.limit ?? 10, input.descending ?? true],
      suiEventsPageSchema,
    );
  }

  async getObject(
    objectId: string,
    options: Record<string, unknown> = {},
  ): Promise<RpcResult<z.infer<typeof suiObjectSchema>>> {
    return this.request("sui_getObject", [objectId, options], suiObjectSchema);
  }
}

export function rpcFromEnv(): TatumSuiRpc {
  return TatumSuiRpc.fromEnv();
}
