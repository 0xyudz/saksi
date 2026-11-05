import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import "./load-env";

import { readJournalRecord, rememberRecovery } from "@/integrations/walrus-memory/client";
import { normalizeWalletRef } from "@/lib/journal-identity";
import { generateRecoveryCode } from "@/lib/recovery-code";

/**
 * Issues a recovery code for an existing journal, keyed by its wallet.
 *
 * Journals created by this code always write a recovery pointer, so this is for the narrow
 * case of a journal whose pointer is missing or was never written. There is no HTTP endpoint
 * that can mint a code for someone else's journal, because that would be an account takeover.
 *
 * Usage: pnpm recovery:issue <wallet> <out-file>
 *
 * The code is written to a file rather than stdout so it never lands in a terminal
 * transcript or a CI log. The file is created owner-read-only.
 */
async function main(): Promise<void> {
  const [walletArg, outFile] = process.argv.slice(2);
  if (!walletArg || !outFile) {
    throw new Error("Usage: pnpm recovery:issue <wallet> <out-file>");
  }

  const wallet = normalizeWalletRef(walletArg);
  const record = await readJournalRecord(wallet);
  if (record === null) {
    throw new Error(`No journal record for ${wallet}. Claim a handle first.`);
  }

  const code = generateRecoveryCode();
  const write = await rememberRecovery({
    code,
    ref: record.ref,
    wallet,
    handle: record.handle,
    createdAt: new Date().toISOString(),
  });

  const target = resolve(outFile);
  writeFileSync(target, `${code}\n`, { mode: 0o600 });

  process.stdout.write(
    `Issued a recovery code for @${record.handle} (${wallet}).\n` +
      `Recovery pointer blob: ${write.blobId}\n` +
      `Namespace: ${write.namespace}\n` +
      `Code written to ${target}. Move it into a password manager, then delete the file.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
