import "./load-env";

import postgres from "postgres";

import { userNamespace } from "@/integrations/walrus-memory/client";
import { UNDERDOG_ODDS_THRESHOLD } from "@/lib/config";
import { analystsFromJournal, reconstructJournal } from "@/server/scoring/reconstruct";
import { detectBias } from "@/server/scoring/bias";

/**
 * Proof that the product can be rebuilt from Walrus Memory.
 *
 * Reads every journal's memories from the relayer, derives credibility and bias from them
 * alone, then compares against the same numbers computed from Postgres. The two must agree
 * for the claim "Walrus is the source of truth" to mean anything.
 *
 * Run: pnpm verify:reconstruct
 */

interface DbRow {
  readonly handle: string;
  readonly user_id: string;
  readonly analyst_id: string;
  readonly analyst_name: string;
  readonly resolved: number;
  readonly wins: number;
  readonly losses: number;
}

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL ?? "");

  const rows = await sql<DbRow[]>`
    select u.handle,
           u.id::text as user_id,
           a.id::text as analyst_id,
           a.name as analyst_name,
           count(o.id) filter (where o.result <> 'void')::int as resolved,
           count(o.id) filter (where o.result = 'win')::int as wins,
           count(o.id) filter (where o.result = 'loss')::int as losses
    from users u
    join picks p on p.user_id = u.id
    join analysts a on a.id = p.analyst_id
    left join outcomes o on o.pick_id = p.id
    group by u.handle, u.id, a.id, a.name
    order by u.handle, a.name
  `;

  const handles = [...new Set(rows.map((row) => row.handle))];
  process.stdout.write("journals with picks: " + handles.length + "\n\n");

  let mismatches = 0;

  for (const handle of handles) {
    const userId = rows.find((row) => row.handle === handle)?.user_id;
    if (userId === undefined) continue;

    const namespace = userNamespace(userId);
    const journal = await reconstructJournal(namespace);
    const analysts = analystsFromJournal(journal);

    process.stdout.write("=== " + handle + " ===\n");
    process.stdout.write(
      "  namespace " +
        namespace +
        "\n  recalled " +
        journal.recalled +
        " memories, kinds: " +
        (journal.kinds.length === 0 ? "(none)" : journal.kinds.join(", ")) +
        "\n  reconstructed picks: " +
        journal.picks.length +
        "\n",
    );

    const dbRows = rows.filter((row) => row.handle === handle);
    for (const dbRow of dbRows) {
      const rebuilt = analysts.find((entry) => entry.analystId === dbRow.analyst_id);
      const rebuiltResolved = rebuilt?.credibility.resolved ?? 0;
      const rebuiltWins = rebuilt?.credibility.wins ?? 0;
      const rebuiltLosses = rebuilt?.credibility.losses ?? 0;

      const match =
        rebuiltResolved === dbRow.resolved &&
        rebuiltWins === dbRow.wins &&
        rebuiltLosses === dbRow.losses;

      if (!match) mismatches += 1;

      process.stdout.write(
        "  analyst " +
          dbRow.analyst_name +
          "\n    postgres      resolved=" +
          dbRow.resolved +
          " wins=" +
          dbRow.wins +
          " losses=" +
          dbRow.losses +
          "\n    from walrus   resolved=" +
          rebuiltResolved +
          " wins=" +
          rebuiltWins +
          " losses=" +
          rebuiltLosses +
          "\n    match         " +
          (match ? "YES" : "NO") +
          "\n",
      );

      if (rebuilt) {
        process.stdout.write(
          "    credibility   score=" +
            rebuilt.credibility.score +
            " verifiedScore=" +
            rebuilt.credibility.verifiedScore +
            " (no oracle flag in memory schema)\n",
        );
        if (rebuilt.bias.length > 0) {
          for (const pattern of rebuilt.bias) {
            process.stdout.write(
              "    bias          " +
                pattern.pattern +
                " (confidence " +
                pattern.confidence.toFixed(3) +
                ")\n",
            );
          }
        } else {
          process.stdout.write("    bias          none detected\n");
        }
      }
    }
    process.stdout.write("\n");
  }

  // Show that bias detection runs on memory data, not on a table.
  const demoUser = rows.find((row) => row.handle === "saksi_demo");
  if (demoUser) {
    const journal = await reconstructJournal(userNamespace(demoUser.user_id));
    const samples = journal.picks
      .filter((pick) => pick.result !== null && pick.odds !== null)
      .map((pick) => ({ odds: pick.odds ?? 0, outcome: pick.result ?? "void" }));
    const patterns = detectBias(samples, UNDERDOG_ODDS_THRESHOLD);
    process.stdout.write(
      "bias check on saksi_demo from memory alone: " +
        samples.length +
        " samples, " +
        patterns.length +
        " pattern(s)\n",
    );
    for (const pattern of patterns) {
      process.stdout.write("  " + pattern.pattern + "\n");
    }
  }

  await sql.end();

  process.stdout.write("\nmismatches: " + mismatches + "\n");
  if (mismatches > 0) {
    process.stdout.write(
      "Reconstruction disagreed with Postgres. Recall may have been truncated (limit 100).\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Reconstruction matches Postgres for every analyst checked.\n");
  }
}

main().catch((error: unknown) => {
  process.stdout.write("ERR " + String(error) + "\n");
  process.exitCode = 1;
});
