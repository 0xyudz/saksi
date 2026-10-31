import { z } from "zod";

import {
  SUI_DIGEST_PATTERN,
  TATUM_MAX_ATTEMPTS,
  TATUM_REQUEST_TIMEOUT_MS,
  TATUM_RETRY_BASE_DELAY_MS,
} from "@/lib/config";
import type { JsonObject } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toJsonValue } from "@/lib/json";
import { errorForLog, getLogger } from "@/lib/logger";

/**
 * Tatum's Sui gateway only exposes GraphQL and gRPC; the JSON-RPC methods this app
 * originally used (`sui_getTransactionBlock`, `suix_getBalance`, `suix_queryEvents`)
 * are gone. Every read below therefore goes through `/graphql`, and the parsed
 * payloads are mapped back onto the small shapes the rest of the app depends on.
 *
 * The free tier allows three requests per second, so requests are serialised through
 * a module-level slot allocator instead of firing in parallel per user request.
 */

const MIN_REQUEST_INTERVAL_MS = 350;
const MAX_BALANCE_CHANGE_PAGES = 10;
const PAGE_SIZE = 50;

const graphQlEnvelopeSchema = z
  .object({
    data: z.unknown().optional(),
    errors: z.object({ message: z.string() }).loose().array().optional(),
  })
  .loose();

const bigIntLike = z.union([z.string(), z.number()]).transform(String);

const rawBalanceChangeSchema = z
  .object({
    owner: z.object({ address: z.string() }).nullish(),
    coinType: z.object({ repr: z.string() }).nullish(),
    amount: bigIntLike,
  })
  .loose();

const rawEventSchema = z
  .object({
    contents: z
      .object({
        type: z.object({ repr: z.string() }).nullish(),
        json: z.unknown().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

const rawPageInfoSchema = z
  .object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullish(),
  })
  .loose();

export const suiTransactionResponseSchema = z
  .object({
    transaction: z
      .object({
        digest: z.string(),
        sender: z.object({ address: z.string() }).nullish(),
        effects: z
          .object({
            status: z.string(),
            executionError: z.object({ message: z.string() }).loose().nullish(),
            timestamp: z.string().nullish(),
            balanceChanges: z
              .object({
                pageInfo: rawPageInfoSchema,
                nodes: rawBalanceChangeSchema.array(),
              })
              .loose(),
            events: z
              .object({
                nodes: rawEventSchema.array(),
              })
              .loose(),
          })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export type SuiTransactionResponse = z.infer<typeof suiTransactionResponseSchema>;

export interface SuiEventRecord {
  readonly type: string;
  readonly parsedJson: unknown;
}

export interface SuiTransactionBlock {
  readonly digest: string;
  readonly timestampMs?: string;
  readonly transaction?: { readonly data: { readonly sender: string } };
  readonly effects?: {
    readonly status: { readonly status: string; readonly error?: string };
  };
  readonly balanceChanges?: ReadonlyArray<{
    readonly owner: { readonly AddressOwner: string };
    readonly coinType: string;
    readonly amount: string;
  }>;
  readonly events?: ReadonlyArray<SuiEventRecord>;
}

export interface SuiBalance {
  readonly coinType: string;
  readonly totalBalance: string;
}

const balanceResponseSchema = z
  .object({
    address: z
      .object({
        balance: z
          .object({
            coinType: z.object({ repr: z.string() }).nullish(),
            totalBalance: bigIntLike,
          })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

const checkpointResponseSchema = z
  .object({
    checkpoint: z.object({ sequenceNumber: bigIntLike }).loose().nullish(),
  })
  .loose();

export interface RpcResult<T> {
  readonly result: T;
  readonly raw: JsonObject;
}

const TRANSACTION_QUERY = `query Transaction($digest: String!, $after: String) {
  transaction(digest: $digest) {
    digest
    sender { address }
    effects {
      status
      executionError { message }
      timestamp
      balanceChanges(first: ${PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { owner { address } coinType { repr } amount }
      }
      events(first: ${PAGE_SIZE}) {
        nodes { contents { type { repr } json } }
      }
    }
  }
}`;

const BALANCE_QUERY = `query Balance($owner: SuiAddress!, $coinType: String!) {
  address(address: $owner) {
    balance(coinType: $coinType) { coinType { repr } totalBalance }
  }
}`;

const CHECKPOINT_QUERY = `query Checkpoint { checkpoint { sequenceNumber } }`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextRequestSlot = 0;

/** Reserves a slot so concurrent callers cannot exceed Tatum's per-second ceiling. */
async function reserveRequestSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestSlot);
  nextRequestSlot = slot + MIN_REQUEST_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

function retryDelay(attempt: number): number {
  return TATUM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
}

export function toSuiTransactionBlock(
  transaction: NonNullable<SuiTransactionResponse["transaction"]>,
  balanceChanges: ReadonlyArray<z.infer<typeof rawBalanceChangeSchema>>,
): SuiTransactionBlock {
  const effects = transaction.effects;
  const sender = transaction.sender?.address;
  const events = effects?.events?.nodes.map((event) => ({
    type: event.contents?.type?.repr ?? "unknown",
    parsedJson: event.contents?.json ?? {},
  }));

  return {
    digest: transaction.digest,
    ...(effects?.timestamp === null || effects?.timestamp === undefined
      ? {}
      : { timestampMs: String(Date.parse(effects.timestamp)) }),
    ...(sender === undefined ? {} : { transaction: { data: { sender } } }),
    ...(effects === null || effects === undefined
      ? {}
      : {
          effects: {
            status: {
              status: effects.status === "SUCCESS" ? "success" : "failure",
              ...(effects.executionError?.message === undefined
                ? {}
                : { error: effects.executionError.message }),
            },
          },
        }),
    balanceChanges: balanceChanges.map((change) => ({
      owner: { AddressOwner: change.owner?.address ?? "" },
      coinType: change.coinType?.repr ?? "",
      amount: change.amount,
    })),
    ...(events === undefined ? {} : { events }),
  };
}

export class TatumSuiClient {
  private readonly url: string;
  private readonly apiKey: string;

  constructor(options: { url: string; apiKey: string }) {
    this.url = options.url;
    this.apiKey = options.apiKey;
  }

  static fromEnv(): TatumSuiClient {
    const env = getEnv();
    return new TatumSuiClient({ url: env.TATUM_SUI_RPC_URL, apiKey: env.TATUM_API_KEY });
  }

  private async execute<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<RpcResult<T>> {
    let lastError: unknown;
    let lastRetryable = false;

    for (let attempt = 1; attempt <= TATUM_MAX_ATTEMPTS; attempt += 1) {
      lastRetryable = false;
      await reserveRequestSlot();

      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(TATUM_REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Tatum GraphQL responded ${response.status}`);
          lastRetryable = true;
          if (attempt < TATUM_MAX_ATTEMPTS) {
            await sleep(retryDelay(attempt));
            continue;
          }
          break;
        }

        const text = await response.text();
        if (!response.ok) {
          throw new AppError(
            "UPSTREAM_UNAVAILABLE",
            `Tatum GraphQL responded ${response.status}.`,
            {
              cause: new Error(text.slice(0, 500)),
            },
          );
        }

        let envelope: z.infer<typeof graphQlEnvelopeSchema>;
        try {
          envelope = graphQlEnvelopeSchema.parse(JSON.parse(text));
        } catch (error) {
          throw new AppError(
            "UPSTREAM_UNAVAILABLE",
            "Tatum GraphQL returned an invalid envelope.",
            {
              cause: error,
            },
          );
        }

        const firstError = envelope.errors?.[0];
        if (firstError) {
          throw new AppError("UPSTREAM_UNAVAILABLE", `Tatum GraphQL error: ${firstError.message}`);
        }

        const parsed = schema.safeParse(envelope.data);
        if (!parsed.success) {
          throw new AppError(
            "UPSTREAM_UNAVAILABLE",
            "Tatum GraphQL returned an unexpected payload.",
            {
              cause: parsed.error,
            },
          );
        }

        return {
          result: parsed.data,
          raw: { query, data: toJsonValue(envelope.data) },
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        lastError = error;
        lastRetryable = true;
        if (attempt < TATUM_MAX_ATTEMPTS) {
          await sleep(retryDelay(attempt));
          continue;
        }
      }
    }

    getLogger().error(
      { error: errorForLog(lastError), query: query.split("\n")[0] },
      "Tatum GraphQL exhausted its retry budget",
    );
    throw new AppError("UPSTREAM_UNAVAILABLE", "Tatum GraphQL call failed.", {
      cause: lastError,
      retryable: lastRetryable,
    });
  }

  async getLatestCheckpoint(): Promise<string> {
    const { result } = await this.execute(CHECKPOINT_QUERY, {}, checkpointResponseSchema);
    if (!result.checkpoint) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "Tatum did not return a checkpoint.");
    }
    return result.checkpoint.sequenceNumber;
  }

  async getTransactionBlock(digest: string): Promise<RpcResult<SuiTransactionBlock>> {
    if (!SUI_DIGEST_PATTERN.test(digest)) {
      throw new AppError("VALIDATION_FAILED", "Invalid Sui transaction digest.");
    }

    const first = await this.execute(
      TRANSACTION_QUERY,
      { digest, after: null },
      suiTransactionResponseSchema,
    );
    const transaction = first.result.transaction;
    if (!transaction) {
      throw new AppError("PAYMENT_NOT_VERIFIED", "Transaction not found.");
    }

    const effects = transaction.effects;
    const changes = [...(effects?.balanceChanges.nodes ?? [])];
    let pageInfo = effects?.balanceChanges.pageInfo;
    let pages = 1;

    while (pageInfo?.hasNextPage === true && pages < MAX_BALANCE_CHANGE_PAGES) {
      const next = await this.execute(
        TRANSACTION_QUERY,
        { digest, after: pageInfo.endCursor ?? null },
        suiTransactionResponseSchema,
      );
      const nextEffects = next.result.transaction?.effects;
      if (!nextEffects) break;
      changes.push(...nextEffects.balanceChanges.nodes);
      pageInfo = nextEffects.balanceChanges.pageInfo;
      pages += 1;
    }

    return {
      result: toSuiTransactionBlock(transaction, changes),
      raw: {
        query: "Transaction",
        digest,
        pages,
        data: toJsonValue(transaction),
      },
    };
  }

  async getBalance(owner: string, coinType: string): Promise<RpcResult<SuiBalance>> {
    const { result, raw } = await this.execute(
      BALANCE_QUERY,
      { owner, coinType },
      balanceResponseSchema,
    );
    const balance = result.address?.balance;

    // `suix_getBalance` answered with a zero balance for an address with no coins;
    // GraphQL returns null, so the same fact is normalised here.
    return {
      result: {
        coinType: balance?.coinType?.repr ?? coinType,
        totalBalance: balance?.totalBalance ?? "0",
      },
      raw,
    };
  }
}

export function clientFromEnv(): TatumSuiClient {
  return TatumSuiClient.fromEnv();
}
