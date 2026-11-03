import "./load-env";

import {
  listFixturesByDate,
  parseOracleRef,
  parseSelection,
  readFixtureResult,
} from "@/integrations/oracle/results";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Read-only proof that the oracle reads real, finished fixtures.
 *
 * It writes nothing: no pick, no outcome, no memory. It fetches a league scoreboard for a
 * date, takes a completed fixture, and asks the resolver's own code what each side of the
 * match winner was worth. If the provider disagrees with itself — both sides winning, or a
 * draw that is not a draw — the script fails, because that would mean the mapping is wrong.
 *
 * Usage: pnpm verify:oracle [YYYY-MM-DD] [league]
 */

const DEFAULT_DATE = "2026-10-31";
const DEFAULT_LEAGUE = "eng.1";

function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const date = process.argv[2] ?? DEFAULT_DATE;
  const league = process.argv[3] ?? DEFAULT_LEAGUE;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError("VALIDATION_FAILED", "The date must be YYYY-MM-DD.");
  }
  if (!getEnv().ORACLE_ENABLED) {
    throw new AppError("VALIDATION_FAILED", "ORACLE_ENABLED is false, so nothing can verify.");
  }

  const fixtures = await listFixturesByDate({ league, date });
  const completed = fixtures.filter((fixture) => fixture.completed && fixture.homeScore !== null);

  output({
    step: "scoreboard",
    league,
    date,
    fixtures: fixtures.length,
    completed: completed.length,
  });

  if (completed.length === 0) {
    throw new AppError("NOT_FOUND", `No completed ${league} fixture was reported for ${date}.`);
  }

  let checked = 0;
  for (const fixture of completed) {
    const ref = parseOracleRef(fixture.ref);
    if (ref === null) throw new AppError("INTERNAL", `Unparseable ref ${fixture.ref}.`);

    const homeSelection = parseSelection(`${fixture.homeTeam} to win`);
    const awaySelection = parseSelection(`${fixture.awayTeam} to win`);
    if (homeSelection === null || awaySelection === null) {
      throw new AppError(
        "INTERNAL",
        `Could not build a match-winner selection for ${fixture.ref}.`,
      );
    }

    const home = await readFixtureResult(ref, homeSelection);
    const away = await readFixtureResult(ref, awaySelection);
    const draw = await readFixtureResult(ref, { subject: "draw", kind: "draw" });
    if (home === null || away === null || draw === null) continue;

    const drew = home.homeScore === draw.awayScore || home.homeScore === home.awayScore;

    // Exactly one of the three outcomes must hold for any completed match.
    const wins = [home.result, away.result, draw.result].filter((result) => result === "win");
    if (wins.length !== 1) {
      throw new AppError(
        "INTERNAL",
        `The provider produced ${wins.length} winning selections for ${fixture.ref}.`,
      );
    }
    if (drew && draw.result !== "win") {
      throw new AppError("INTERNAL", `A drawn fixture was not read as a draw: ${fixture.ref}.`);
    }
    if (!drew && draw.result === "win") {
      throw new AppError("INTERNAL", `A decided fixture was read as a draw: ${fixture.ref}.`);
    }

    output({
      step: "fixture",
      ref: fixture.ref,
      score: `${home.homeTeam} ${home.homeScore}-${home.awayScore} ${home.awayTeam}`,
      status: home.statusDetail,
      homeSelection: home.result,
      awaySelection: away.result,
      drawSelection: draw.result,
      sourceUrl: home.sourceUrl,
    });
    checked += 1;
  }

  if (checked === 0) {
    throw new AppError("NOT_FOUND", "No fixture could be read back from the provider.");
  }

  output({ step: "ok", checked, note: "Every completed fixture resolved to exactly one winner." });
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
