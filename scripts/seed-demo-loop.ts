import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import "./load-env";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { eq } from "drizzle-orm";

import { closeDb, getDb } from "@/db/client";
import { analysts } from "@/db/schema";
import { readJournalRecord } from "@/integrations/walrus-memory/client";
import { normalizeWalletRef } from "@/lib/journal-identity";
import { claimJournal } from "@/server/data/journal";
import { createPick } from "@/server/usecases/create-pick";
import { recommend } from "@/server/usecases/recommend";
import { resolvePick } from "@/server/usecases/resolve-pick";
import { revealPick } from "@/server/usecases/reveal-pick";
import { issueWalletChallenge } from "@/server/wallet-auth";

/**
 * Seeds the learning loop with a journal that is obviously synthetic.
 *
 * Why this exists: every resolved pick in the live database won, so `detectBias()` never
 * fired and the product's central claim — that a recalled memory changes the next decision
 * — had no evidence behind it. This script creates that evidence without dressing it up:
 *
 * - The handle is `demo_loop` and every market and selection is prefixed `synthetic demo`,
 *   so nothing here can be read as a real forecast.
 * - `sourceUrl` points at the journal's own page, not at a match report. These resolutions
 *   are self-attested and the stored `verification` says `self_attested`.
 * - The two losses are underdogs at odds >= 2.5, which is the exact condition
 *   `detectBias()` looks for, so the bias memory is the real detector's real output.
 *
 * Usage:
 *   pnpm tsx scripts/seed-demo-loop.ts <base-url> <out-file> [--wallet 0x...]
 *
 * Without `--wallet` the script generates an Ed25519 keypair, claims a fresh journal and
 * writes its recovery code to `<out-file>` (mode 0600). The recovery code is enough to sign
 * in at `/resume`, so the private key is never written anywhere.
 *
 * With `--wallet` it seeds an existing journal and writes no file. Only the journal ref is
 * needed: the use-cases take it as an argument and no signature is involved.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const [baseUrl, outFile] = positional;

  if (!baseUrl || !outFile) {
    throw new Error(
      "Usage: pnpm tsx scripts/seed-demo-loop.ts <base-url> <out-file> [--wallet 0x...]",
    );
  }
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    throw new Error(
      "Refusing to write localhost URLs into Walrus: those blobs are permanent and public.",
    );
  }
  if (!baseUrl.startsWith("https://")) {
    throw new Error("The base URL must be https, because it is written into permanent blobs.");
  }

  const target = resolve(outFile);
  if (target.toLowerCase().startsWith(process.cwd().toLowerCase())) {
    throw new Error(`Refusing to write ${target} inside the repository. Choose a path outside it.`);
  }

  const walletFlagIndex = argv.indexOf("--wallet");
  const existingWallet = walletFlagIndex === -1 ? undefined : argv[walletFlagIndex + 1];

  let ref: string;
  let handle: string;
  let recoveryCode: string | null = null;

  if (existingWallet === undefined) {
    const keypair = new Ed25519Keypair();
    const address = keypair.toSuiAddress();
    const created = await claimAndSign(keypair, address);
    ref = created.journal.ref;
    handle = created.journal.handle;
    recoveryCode = created.recoveryCode;
    process.stdout.write(`claimed   @${handle}  ${ref}\n`);
    process.stdout.write(`identity  blob ${created.receipts.journal}\n`);
    process.stdout.write(`recovery  blob ${created.receipts.recovery}\n\n`);
  } else {
    ref = normalizeWalletRef(existingWallet);
    const record = await readJournalRecord(ref);
    if (record === null) {
      throw new Error(`No journal record for ${ref}. Claim a handle at /onboarding first.`);
    }
    handle = record.handle;
    process.stdout.write(`reusing   @${handle}  ${ref}\n\n`);
  }

  const base = baseUrl.replace(/\/$/, "");
  const analystName = `DEMO synthetic analyst (${handle})`;
  const analystId = await ensureAnalyst(analystName);

  process.stdout.write(`analyst   ${analystId}  "${analystName}"\n\n`);

  for (const demo of DEMO_PICKS) {
    const created = await createPick(ref, {
      analystId,
      eventRef: demo.eventRef,
      market: demo.market,
      selection: demo.selection,
      odds: demo.odds,
      stakeUnits: 1,
    });
    process.stdout.write(`sealed    ${demo.selection} @ ${demo.odds}\n`);

    const revealed = await revealPick(ref, created.pick.id);
    if (!revealed.verified) {
      throw new Error(`Reveal of ${created.pick.id} did not verify against its commitment.`);
    }

    const resolved = await resolvePick(ref, created.pick.id, {
      result: demo.result,
      sourceUrl: `${base}/journals/${encodeURIComponent(`saksi:${ref}`)}`,
    });
    process.stdout.write(
      `resolved  ${demo.result}  verification=${resolved.outcome.verification}` +
        `  bias=${resolved.biasPattern ?? "none"}\n`,
    );
  }

  process.stdout.write("\n=== recommendation after the loop ===\n");
  const verdict = await recommend(ref, {
    analystId,
    market: "synthetic demo · match winner",
    selection: "DEMO underdog E to win",
    odds: 2.9,
  });

  process.stdout.write(`verdict   ${verdict.verdict}\n`);
  process.stdout.write(
    `recalled  ${verdict.recallCount} memories, cited ${verdict.citations.length}\n`,
  );
  process.stdout.write(`summary   ${verdict.summary}\n`);
  for (const warning of verdict.warnings) {
    process.stdout.write(
      `warning   ${warning.kind} (evidence ${warning.evidence}) ${warning.message}\n`,
    );
  }

  const biasApplied = verdict.warnings.some((warning) => warning.kind === "bias");
  if (!biasApplied) {
    process.stdout.write(
      "\nNO BIAS WARNING. The bias memory was written but not recalled. This is the honest\n" +
        "result of the run; do not claim the verdict changed until it does.\n",
    );
  }

  process.stdout.write(`\njournal   ${base}/journals/${encodeURIComponent(`saksi:${ref}`)}\n`);

  if (recoveryCode !== null) {
    writeFileSync(target, `${recoveryCode}\n`, { mode: 0o600 });
    process.stdout.write(
      `code      written to ${target}\n` +
        "          Sign in at /resume with it, then move it into a password manager and\n" +
        "          delete the file. No private key was saved anywhere.\n",
    );
  }
}

interface DemoPick {
  readonly eventRef: string;
  readonly market: string;
  readonly selection: string;
  readonly odds: number;
  readonly result: "win" | "loss";
}

const SYNTHETIC_MARKET = "synthetic demo · match winner";

/**
 * Five favourites that won, then two underdogs that lost.
 *
 * The order matters: the second underdog loss is what makes `detectBias()` fire, and the
 * five wins are what keep credibility high enough that the downgrade is visible. With a
 * losing record the base verdict would already be `avoid`, so a downgrade would prove
 * nothing.
 */
const DEMO_PICKS: ReadonlyArray<DemoPick> = [
  {
    eventRef: "demo:synthetic:favourite-1",
    market: SYNTHETIC_MARKET,
    selection: "DEMO favourite A to win",
    odds: 1.25,
    result: "win",
  },
  {
    eventRef: "demo:synthetic:favourite-2",
    market: SYNTHETIC_MARKET,
    selection: "DEMO favourite B to win",
    odds: 1.28,
    result: "win",
  },
  {
    eventRef: "demo:synthetic:favourite-3",
    market: SYNTHETIC_MARKET,
    selection: "DEMO favourite C to win",
    odds: 1.3,
    result: "win",
  },
  {
    eventRef: "demo:synthetic:favourite-4",
    market: SYNTHETIC_MARKET,
    selection: "DEMO favourite D to win",
    odds: 1.32,
    result: "win",
  },
  {
    eventRef: "demo:synthetic:favourite-5",
    market: SYNTHETIC_MARKET,
    selection: "DEMO favourite E to win",
    odds: 1.35,
    result: "win",
  },
  {
    eventRef: "demo:synthetic:underdog-1",
    market: SYNTHETIC_MARKET,
    selection: "DEMO underdog F to win",
    odds: 3.1,
    result: "loss",
  },
  {
    eventRef: "demo:synthetic:underdog-2",
    market: SYNTHETIC_MARKET,
    selection: "DEMO underdog G to win",
    odds: 3.4,
    result: "loss",
  },
];

/**
 * Claims a journal by actually signing the challenge, rather than by calling the use-case
 * with a bypass. The signature path is the product's own, so a broken verifier fails here
 * instead of quietly producing a journal nothing can sign into.
 */
async function claimAndSign(
  keypair: Ed25519Keypair,
  address: string,
): Promise<Awaited<ReturnType<typeof claimJournal>>> {
  const handle = "demo_loop";
  const challenge = await issueWalletChallenge({ address, purpose: "claim", subject: handle });
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );

  return claimJournal({ handle, address, nonce: challenge.nonce, signature });
}

async function ensureAnalyst(name: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: analysts.id })
    .from(analysts)
    .where(eq(analysts.name, name))
    .limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;

  const inserted = await db
    .insert(analysts)
    .values({ name, kind: "human", externalRef: "synthetic-demo-loop" })
    .returning({ id: analysts.id });
  const created = inserted[0];
  if (created === undefined) throw new Error("The analyst insert returned no row.");
  return created.id;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    await closeDb();
  });
