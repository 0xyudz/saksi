"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({
    pick: z.object({ id: z.string().uuid(), commitmentHash: z.string() }).loose(),
    memory: z.object({ blobId: z.string() }).loose(),
  })
  .loose();

const fixturesSchema = z
  .object({
    leagueLabel: z.string(),
    fixtures: z.array(
      z
        .object({
          ref: z.string(),
          homeTeam: z.string(),
          awayTeam: z.string(),
          homeScore: z.number().nullable(),
          awayScore: z.number().nullable(),
          completed: z.boolean(),
          statusDetail: z.string(),
          kickoff: z.string().nullable(),
        })
        .loose(),
    ),
  })
  .loose();

type Fixture = z.infer<typeof fixturesSchema>["fixtures"][number];

export interface AnalystOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export function NewPickForm({ analysts }: { readonly analysts: readonly AnalystOption[] }) {
  const router = useRouter();
  const [analystId, setAnalystId] = useState(analysts[0]?.id ?? "");
  const [eventRef, setEventRef] = useState("");
  const [market, setMarket] = useState("");
  const [selection, setSelection] = useState("");
  const [odds, setOdds] = useState("2.10");
  const [stakeUnits, setStakeUnits] = useState("10");
  const [revealAt, setRevealAt] = useState("");
  const [oracleEventRef, setOracleEventRef] = useState("");

  const [fixtureDate, setFixtureDate] = useState("");
  const [fixtures, setFixtures] = useState<readonly Fixture[] | null>(null);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [fixturePending, setFixturePending] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function loadFixtures() {
    if (fixtureDate.length === 0) {
      setFixtureError("Pick a date first.");
      return;
    }
    setFixturePending(true);
    setFixtureError(null);
    try {
      const result = await requestJson({
        url: `/api/oracle/fixtures?date=${encodeURIComponent(fixtureDate)}`,
        schema: fixturesSchema,
      });
      setFixtures(result.fixtures);
      if (result.fixtures.length === 0) {
        setFixtureError(`No ${result.leagueLabel} fixtures reported for that date.`);
      }
    } catch (caught) {
      setFixtures(null);
      setFixtureError(caught instanceof Error ? caught.message : "Could not load fixtures.");
    } finally {
      setFixturePending(false);
    }
  }

  function chooseFixture(fixture: Fixture) {
    setOracleEventRef(fixture.ref);
    setEventRef(fixture.ref);
    setMarket((current) => (current.trim().length > 0 ? current : "Premier League · Match winner"));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await requestJson({
        url: "/api/picks",
        method: "POST",
        body: {
          analystId,
          eventRef: eventRef.trim(),
          market: market.trim(),
          selection: selection.trim(),
          odds: Number(odds),
          stakeUnits: Number(stakeUnits),
          ...(revealAt.length === 0 ? {} : { revealAt: new Date(revealAt).toISOString() }),
          ...(oracleEventRef.length === 0 ? {} : { oracleEventRef }),
        },
        schema: responseSchema,
      });
      router.push(`/picks/${result.pick.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not seal the pick.");
    } finally {
      setPending(false);
    }
  }

  if (analysts.length === 0) {
    return (
      <p className="border-amber/30 bg-amber/5 text-amber rounded-xl border px-4 py-3 text-sm leading-relaxed">
        Add an analyst first — a pick needs a subject whose credibility can be scored.{" "}
        <Link href="/analysts" className="underline">
          Add one on the analysts page
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className="label" htmlFor="pick-analyst">
          Analyst
        </label>
        <select
          id="pick-analyst"
          className="select"
          value={analystId}
          onChange={(event) => setAnalystId(event.target.value)}
          required
        >
          {analysts.map((analyst) => (
            <option key={analyst.id} value={analyst.id}>
              {analyst.name} · {analyst.kind}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pick-event">
            Event reference
          </label>
          <input
            id="pick-event"
            className="input"
            value={eventRef}
            onChange={(event) => setEventRef(event.target.value)}
            placeholder="fixture id, market slug, URL"
            minLength={2}
            maxLength={200}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pick-market">
            Market
          </label>
          <input
            id="pick-market"
            className="input"
            value={market}
            onChange={(event) => setMarket(event.target.value)}
            placeholder="Premier League · Match winner"
            minLength={2}
            maxLength={200}
            required
          />
        </div>
      </div>

      <div className="border-line rounded-xl border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
              Independent result (optional)
            </p>
            <p className="text-muted mt-1 text-xs leading-relaxed">
              Link the fixture from a provider Saksi does not control. Only linked picks can be
              marked oracle-verified; unlinked ones stay self-attested and are labelled that way.
            </p>
          </div>
          {oracleEventRef.length > 0 ? (
            <button
              type="button"
              className="mono text-muted hover:text-paper text-[10px] tracking-[0.12em] uppercase"
              onClick={() => setOracleEventRef("")}
            >
              clear link
            </button>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="fixture-date">
              Fixture date
            </label>
            <input
              id="fixture-date"
              className="input"
              type="date"
              value={fixtureDate}
              onChange={(event) => setFixtureDate(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost h-10 text-xs"
            onClick={loadFixtures}
            disabled={fixturePending}
          >
            {fixturePending ? "Reading provider…" : "Find fixtures"}
          </button>
        </div>

        {fixtureError ? <p className="text-muted mt-3 text-xs">{fixtureError}</p> : null}

        {fixtures !== null && fixtures.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {fixtures.map((fixture) => {
              const chosen = fixture.ref === oracleEventRef;
              return (
                <li key={fixture.ref}>
                  <button
                    type="button"
                    onClick={() => chooseFixture(fixture)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      chosen
                        ? "border-amber/50 bg-amber/10 text-paper"
                        : "border-line text-muted hover:text-paper hover:border-white/20"
                    }`}
                  >
                    <span>
                      {fixture.homeTeam}
                      {fixture.homeScore === null ? "" : ` ${fixture.homeScore}`}
                      {" – "}
                      {fixture.awayScore === null ? "" : `${fixture.awayScore} `}
                      {fixture.awayTeam}
                    </span>
                    <span className="mono text-[10px] tracking-[0.1em] uppercase">
                      {fixture.statusDetail} · {fixture.ref}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {oracleEventRef.length > 0 ? (
          <p className="mono text-green mt-3 text-[11px] break-all">linked {oracleEventRef}</p>
        ) : (
          <p className="text-muted mt-3 text-xs leading-relaxed">
            No fixture linked. This pick will resolve as self-attested and will not count toward a
            verified record.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="pick-selection">
          Selection
        </label>
        <input
          id="pick-selection"
          className="input"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          placeholder="Arsenal to win"
          minLength={1}
          maxLength={200}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="pick-odds">
            Decimal odds
          </label>
          <input
            id="pick-odds"
            className="input mono"
            type="number"
            step="0.01"
            min="1.01"
            max="1000"
            value={odds}
            onChange={(event) => setOdds(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pick-stake">
            Stake units
          </label>
          <input
            id="pick-stake"
            className="input mono"
            type="number"
            step="1"
            min="1"
            max="1000000"
            value={stakeUnits}
            onChange={(event) => setStakeUnits(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pick-reveal">
            Time lock <span className="normal-case">(optional)</span>
          </label>
          <input
            id="pick-reveal"
            className="input"
            type="datetime-local"
            value={revealAt}
            onChange={(event) => setRevealAt(event.target.value)}
          />
        </div>
      </div>

      <p className="text-muted text-xs leading-relaxed">
        Sealing writes the canonical payload hash and the full pick to Walrus Memory. The hash is
        what later verification checks; changing any field breaks the reveal.
      </p>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sealing to Walrus…" : "Seal this pick"}
      </button>
    </form>
  );
}
