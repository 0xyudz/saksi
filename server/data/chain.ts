import { z } from "zod";

import { TatumSuiRpc } from "@/integrations/tatum/rpc";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toJsonObject } from "@/lib/json";
import { errorForLog, getLogger } from "@/lib/logger";

export interface AgentBalance {
  readonly owner: string;
  readonly coinType: string;
  readonly totalBalance: string;
  readonly coinObjectCount: number;
}

export interface ChainHealth {
  readonly checkpoint: string;
  readonly network: string;
}

export interface OnChainEvent {
  readonly digest: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export async function chainHealth(): Promise<ChainHealth> {
  const env = getEnv();
  const checkpoint = await TatumSuiRpc.fromEnv().getLatestCheckpoint();
  return { checkpoint, network: env.SUI_NETWORK };
}

export async function agentBalance(): Promise<AgentBalance> {
  const env = getEnv();
  const { result } = await TatumSuiRpc.fromEnv().getBalance(
    env.AGENT_SUI_ADDRESS,
    env.SUI_USDC_COIN_TYPE,
  );
  return {
    owner: env.AGENT_SUI_ADDRESS,
    coinType: result.coinType,
    totalBalance: result.totalBalance,
    coinObjectCount: result.coinObjectCount,
  };
}

/**
 * The dashboard feed uses `suix_queryEvents` against the transactions Saksi already
 * verified. A settlement may legitimately emit no events, so an empty list is a fact,
 * not a fallback.
 */
export async function eventsForDigests(digests: readonly string[]): Promise<OnChainEvent[]> {
  const targets = digests.slice(0, 10);
  if (targets.length === 0) return [];

  const rpc = TatumSuiRpc.fromEnv();
  const settled = await Promise.allSettled(
    targets.map(async (digest) => {
      const page = await rpc.queryEvents({
        query: { Transaction: digest },
        limit: 20,
        descending: true,
      });
      return page.result.data.map((event) => {
        const record = z
          .object({ type: z.string().optional(), parsedJson: z.unknown().optional() })
          .loose()
          .parse(event);
        return {
          digest,
          type: record.type ?? "unknown",
          payload: toJsonObject(record.parsedJson ?? {}),
        };
      });
    }),
  );

  const failures = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  const events = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  if (failures.length === settled.length) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "Tatum could not return events for any digest.", {
      cause: failures[0],
    });
  }
  if (failures.length > 0) {
    getLogger().warn(
      { failures: failures.length, requested: targets.length, error: errorForLog(failures[0]) },
      "some settlement event queries failed",
    );
  }

  return events;
}
