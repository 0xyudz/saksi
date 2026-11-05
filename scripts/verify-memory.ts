import { randomUUID } from "node:crypto";

import "./load-env";

import {
  health,
  listMemories,
  listNamespaces,
  recall,
  remember,
  userNamespace,
} from "@/integrations/walrus-memory/client";
import { buildPreferenceMemory } from "@/integrations/walrus-memory/schema";
import { getEnv } from "@/lib/env";
import { isWalletRef } from "@/lib/journal-identity";

/**
 * End-to-end check of Walrus Memory: write, recall, list.
 *
 * It writes a real memory, so it needs a real journal ref to write into. Pass one as the
 * first argument — a Sui address, or a legacy uuid. Without an argument it picks the busiest
 * namespace under this deployment's prefix, so the check still runs against real data
 * instead of a mock.
 *
 * Usage: pnpm verify:memory [<wallet-or-ref>]
 */
function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function resolveRef(): Promise<{ ref: string; source: string }> {
  const explicit = process.argv[2];
  if (explicit !== undefined && explicit.length > 0) {
    return { ref: explicit, source: "argument" };
  }

  const prefix = getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX;
  const namespaces = await listNamespaces();
  const mine = namespaces
    .filter((entry) => entry.name.startsWith(`${prefix}:`) && !entry.name.includes(":probe:"))
    .sort((a, b) => b.memoryCount - a.memoryCount);

  const busiest = mine[0];
  if (!busiest) {
    throw new Error(
      "No namespace under this prefix. Create a journal at /onboarding, or pass a ref explicitly.",
    );
  }
  return { ref: busiest.name.slice(prefix.length + 1), source: "busiest namespace" };
}

async function main(): Promise<void> {
  const runtime = await health();
  output({ step: "health", status: runtime.status, version: runtime.version });

  const { ref, source } = await resolveRef();
  output({ step: "ref", ref, source, namespace: userNamespace(ref), wallet: isWalletRef(ref) });

  const marker = `verify-memory ${new Date().toISOString()} ${randomUUID()}`;
  const memory = buildPreferenceMemory({
    userId: ref,
    statement: `Verification probe: ${marker}`,
  });
  const wrote = await remember(ref, memory);
  output({
    step: "rememberAndWait",
    namespace: wrote.namespace,
    blobId: wrote.blobId,
    jobId: wrote.jobId,
  });

  const recalled = await recall(ref, marker);
  const hit = recalled.hits.find((candidate) => candidate.citation.text === memory.text);
  if (!hit) {
    throw new Error("The freshly written memory was not returned by recall().");
  }
  output({
    step: "recall",
    blobId: hit.citation.blobId,
    distance: hit.citation.distance,
    text: hit.citation.text,
  });

  const ledger = await listMemories(ref);
  output({
    step: "listMemories",
    fetched: ledger.fetched,
    hasMore: ledger.hasMore,
    truncated: ledger.truncated,
  });

  if (ledger.fetched < 1) {
    throw new Error("listMemories() fetched zero memories after a successful write.");
  }
}

main()
  .then(() => {
    output({ ok: true });
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
