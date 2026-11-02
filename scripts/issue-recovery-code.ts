import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import "./load-env";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "@/db/client";
import { users } from "@/db/schema";
import { generateRecoveryCode, hashRecoveryCode } from "@/lib/recovery-code";

/**
 * Issues a recovery code for an existing journal.
 *
 * Journals created before recovery existed have no hash, so they cannot be resumed. This
 * is the only way to give such a journal a credential again, and it is intentionally an
 * operator-run CLI: there is no HTTP endpoint that can mint a code for someone else's
 * handle, because that would be an account takeover.
 *
 * Usage: pnpm recovery:issue <handle> <out-file>
 *
 * The code is written to a file rather than stdout so it never lands in a terminal
 * transcript or a CI log.
 */
async function main(): Promise<void> {
  const [handle, outFile] = process.argv.slice(2);
  if (!handle || !outFile) {
    throw new Error("Usage: pnpm recovery:issue <handle> <out-file>");
  }

  const db = getDb();
  const rows = await db
    .select({ id: users.id, handle: users.handle, recoveryHash: users.recoveryHash })
    .from(users)
    .where(eq(users.handle, handle.toLowerCase()))
    .limit(1);

  const user = rows[0];
  if (!user) throw new Error(`No journal with handle "${handle}".`);
  if (user.recoveryHash !== null) {
    throw new Error(
      `Journal "${user.handle}" already has a recovery code. Overwriting it would lock out the current holder.`,
    );
  }

  const code = generateRecoveryCode();
  const recoveryHash = await hashRecoveryCode(code);
  await db.update(users).set({ recoveryHash }).where(eq(users.id, user.id));

  const target = resolve(outFile);
  writeFileSync(target, `${code}\n`, { mode: 0o600 });

  process.stdout.write(
    `Issued a recovery code for @${user.handle} and wrote it to ${target}\n` +
      `Move it into a password manager, then delete the file.\n`,
  );
  await closeDb();
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await closeDb();
  process.exitCode = 1;
});
