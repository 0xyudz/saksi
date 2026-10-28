import { randomUUID } from "node:crypto";

import "./load-env";

import { closeDb, getDb } from "@/db/client";
import { users } from "@/db/schema";
import { buildPreferenceMemory } from "@/integrations/walrus-memory/schema";
import {
  health,
  listMemories,
  recall,
  remember,
  userNamespace,
} from "@/integrations/walrus-memory/client";

function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const runtime = await health();
  output({ step: "health", status: runtime.status, version: runtime.version });

  const rows = await getDb().select({ id: users.id, handle: users.handle }).from(users).limit(1);
  const user = rows[0];
  if (!user) {
    throw new Error(
      "No journal user exists. Create one at /onboarding so verification can write to a real namespace.",
    );
  }

  const marker = `verify-memory ${new Date().toISOString()} ${randomUUID()}`;
  const memory = buildPreferenceMemory({
    userId: user.id,
    statement: `Verification probe: ${marker}`,
  });
  const wrote = await remember(user.id, memory);
  output({
    step: "rememberAndWait",
    namespace: userNamespace(user.id),
    blobId: wrote.blobId,
    jobId: wrote.jobId,
  });

  const recalled = await recall(user.id, marker);
  const hit = recalled.citations.find((citation) => citation.text === memory.text);
  if (!hit) {
    throw new Error("The freshly written memory was not returned by recall().");
  }
  output({
    step: "recall",
    blobId: hit.blobId,
    distance: hit.distance,
    text: hit.text,
  });

  const ledger = await listMemories(user.id);
  output({ step: "listMemories", total: ledger.total, hasMore: ledger.hasMore });

  if (ledger.total < 1) {
    throw new Error("listMemories() reported zero memories after a successful write.");
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
  })
  .finally(async () => {
    await closeDb();
  });
