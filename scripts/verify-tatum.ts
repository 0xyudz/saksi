import "./load-env";

import { TatumSuiRpc } from "@/integrations/tatum/rpc";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/logger";

function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.TATUM_VERIFY_DIGEST) {
    throw new Error(
      "TATUM_VERIFY_DIGEST is not set. Export a real Sui transaction digest to verify.",
    );
  }

  const rpc = TatumSuiRpc.fromEnv();
  const checkpoint = await rpc.getLatestCheckpoint();
  output({ step: "checkpoint", network: env.SUI_NETWORK, checkpoint });

  const transaction = await rpc.getTransactionBlock(env.TATUM_VERIFY_DIGEST, {
    showEffects: true,
    showEvents: true,
    showBalanceChanges: true,
    showInput: true,
  });

  const status = transaction.result.effects?.status.status;
  if (status !== "success") {
    throw new Error(`Transaction ${env.TATUM_VERIFY_DIGEST} status is ${status ?? "unknown"}.`);
  }

  const sender = transaction.result.transaction?.data.sender;
  const eventCount = transaction.result.events?.length ?? 0;
  output({
    step: "transaction",
    digest: transaction.result.digest,
    status,
    sender: sender ?? "unavailable",
    events: eventCount,
  });

  const balance = await rpc.getBalance(env.AGENT_SUI_ADDRESS, env.SUI_USDC_COIN_TYPE);
  output({
    step: "balance",
    owner: env.AGENT_SUI_ADDRESS,
    coinType: balance.result.coinType,
    totalBalance: balance.result.totalBalance,
    coinObjectCount: balance.result.coinObjectCount,
  });

  getLogger().info({ digest: transaction.result.digest }, "tatum verification completed");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
