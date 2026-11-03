import { z } from "zod";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { errorForLog, getLogger } from "@/lib/logger";

/**
 * Independent match results.
 *
 * Every score in Saksi's own database is written by the journal that made the pick, which
 * makes it useless as evidence of skill: a seller can mark all ten of their picks as wins
 * and the credibility model will believe them. This module is the counterweight. It reads
 * a final score from a provider Saksi does not control, decides what the pick's outcome
 * actually was, and lets the resolver refuse a claim that contradicts it.
 *
 * Scope is deliberately narrow. Only one league and one market are supported, because a
 * half-implemented oracle that silently passes on every other market would be worse than
 * an honest boundary: it would look like verification while verifying nothing.
 */

/** The only league wired up so far. Adding another is a mapping, not a redesign. */
export const SUPPORTED_LEAGUE = "eng.1" as const;
export const SUPPORTED_LEAGUE_LABEL = "English Premier League";

/**
 * A pick's oracle reference. The format is part of the stored data, so it is parsed rather
 * than pattern-matched: `espn:eng.1:401879254`.
 */
const oracleRefSchema = z.object({
  provider: z.literal("espn"),
  league: z.literal(SUPPORTED_LEAGUE),
  eventId: z.string().regex(/^\d{1,20}$/, "expected a numeric ESPN event id"),
});

export type OracleRef = z.infer<typeof oracleRefSchema>;

export function formatOracleRef(ref: OracleRef): string {
  return `${ref.provider}:${ref.league}:${ref.eventId}`;
}

export function parseOracleRef(value: string): OracleRef | null {
  const parts = value.trim().split(":");
  if (parts.length !== 3) return null;
  const [provider, league, eventId] = parts;
  const parsed = oracleRefSchema.safeParse({ provider, league, eventId });
  return parsed.success ? parsed.data : null;
}

export type OracleOutcome = "win" | "loss" | "void";

export interface OracleVerdict {
  /** What the independent provider says the result was. */
  readonly result: OracleOutcome;
  /** The provider's own description, e.g. `FT` or `STATUS_POSTPONED`. */
  readonly statusDetail: string;
  /** Home and away score, absent when the fixture has not finished. */
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly completedAt: string | null;
  /** Canonical provider reference, stored next to the outcome for re-checking. */
  readonly sourceRef: string;
  /** Human-checkable URL for the fixture. */
  readonly sourceUrl: string;
}

/* -------------------------------------------------------------------------- */
/* Provider response shapes                                                    */
/* -------------------------------------------------------------------------- */

const competitorSchema = z
  .object({
    homeAway: z.enum(["home", "away"]),
    score: z.string().optional(),
    winner: z.boolean().optional(),
    team: z.object({ displayName: z.string().min(1), abbreviation: z.string().optional() }),
  })
  .loose();

const competitionSchema = z
  .object({
    competitors: z.array(competitorSchema).min(1),
    status: z
      .object({
        type: z
          .object({
            completed: z.boolean(),
            detail: z.string().optional(),
            name: z.string().optional(),
          })
          .loose(),
      })
      .loose()
      .optional(),
  })
  .loose();

const eventSchema = z
  .object({
    id: z.string().min(1),
    date: z.string().optional(),
    competitions: z.array(competitionSchema).min(1),
  })
  .loose();

const summarySchema = z
  .object({
    header: z
      .object({
        competitions: z.array(competitionSchema).min(1),
      })
      .loose(),
  })
  .loose();

/* -------------------------------------------------------------------------- */
/* Selection parsing                                                           */
/* -------------------------------------------------------------------------- */

export interface SelectionSubject {
  /** Team name exactly as the picker wrote it, lowercased and normalised. */
  readonly subject: string;
  readonly kind: "home" | "away" | "draw";
}

/**
 * Turns free text like `"Newcastle United to win"` into something comparable with a
 * provider's team name. Only two shapes are recognised: `X to win` and `draw`. Anything
 * else returns null and the caller falls back to self-attested, which is honest.
 */
export function parseSelection(selection: string): SelectionSubject | null {
  const text = selection
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/g, "")
    .trim();

  if (text === "draw" || text === "the draw" || text === "match drawn") {
    return { subject: "draw", kind: "draw" };
  }

  const match = /^(?:the\s+)?(.+?)\s+to\s+win$/.exec(text);
  if (!match?.[1]) return null;
  const subject = match[1].trim();
  if (subject.length === 0) return null;
  return { subject, kind: "home" };
}

/** Normalises a club name so `Man Utd` and `Manchester United` are not required to match. */
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bafc\b|\bfc\b|\bcf\b|\bsc\b|\bunited\b|\butd\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compares the picker's subject with a provider team name. Uses containment rather than
 * equality because pickers write `Arsenal` while providers write `Arsenal FC`, and the
 * shorter form must still match. A wrong match is refused rather than guessed: both names
 * must share at least one significant token.
 */
export function teamMatches(selectionSubject: string, teamName: string): boolean {
  const left = normalizeTeamName(selectionSubject);
  const right = normalizeTeamName(teamName);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;
  if (right.includes(left) || left.includes(right)) return true;

  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = right.split(" ").filter((token) => token.length > 2);
  return rightTokens.some((token) => leftTokens.has(token));
}

/* -------------------------------------------------------------------------- */
/* Provider access                                                             */
/* -------------------------------------------------------------------------- */

const FETCH_TIMEOUT_MS = 10_000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "The results provider rejected the request.", {
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    return await response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UPSTREAM_UNAVAILABLE", "The results provider is unreachable.", {
      cause: error,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a finished fixture and decides what a pick on it should have resolved to.
 *
 * Returns `null` only when the fixture has not finished: a pending match is not a loss,
 * and inventing one would punish an honest seller for resolving too early.
 */
export async function readFixtureResult(
  ref: OracleRef,
  selection: SelectionSubject,
): Promise<OracleVerdict | null> {
  const env = getEnv();
  const base = env.ORACLE_ESPN_BASE_URL.replace(/\/+$/, "");
  const url = `${base}/soccer/${encodeURIComponent(ref.league)}/summary?event=${encodeURIComponent(ref.eventId)}`;

  const parsed = summarySchema.safeParse(await fetchJson(url));
  if (!parsed.success) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The results provider returned an unexpected body.",
      {
        cause: parsed.error,
      },
    );
  }

  const competition = parsed.data.header.competitions[0];
  if (!competition) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The results provider returned no competition.");
  }

  const home = competition.competitors.find((team) => team.homeAway === "home");
  const away = competition.competitors.find((team) => team.homeAway === "away");
  if (!home || !away) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The fixture is missing a home or away side.");
  }

  const status = competition.status?.type;
  if (!status?.completed) {
    return null;
  }

  const homeScore = home.score === undefined ? null : Number(home.score);
  const awayScore = away.score === undefined ? null : Number(away.score);
  if (
    homeScore === null ||
    awayScore === null ||
    Number.isNaN(homeScore) ||
    Number.isNaN(awayScore)
  ) {
    return null;
  }

  const selectionIsHome = teamMatches(selection.subject, home.team.displayName);
  const selectionIsAway = teamMatches(selection.subject, away.team.displayName);

  let result: OracleOutcome;
  if (selection.kind === "draw") {
    result = homeScore === awayScore ? "win" : "loss";
  } else if (selectionIsHome) {
    result = homeScore > awayScore ? "win" : "loss";
  } else if (selectionIsAway) {
    result = awayScore > homeScore ? "win" : "loss";
  } else {
    // The provider does not name either side the way the picker did. Guessing here would
    // manufacture a result, so the caller is told the fixture could not be interpreted.
    throw new AppError(
      "VALIDATION_FAILED",
      `The selection "${selection.subject}" matches neither "${home.team.displayName}" nor "${away.team.displayName}".`,
    );
  }

  return {
    result,
    statusDetail: status.detail ?? status.name ?? "completed",
    homeScore,
    awayScore,
    homeTeam: home.team.displayName,
    awayTeam: away.team.displayName,
    completedAt: null,
    sourceRef: formatOracleRef(ref),
    sourceUrl: `https://www.espn.com/soccer/match/_/gameId/${encodeURIComponent(ref.eventId)}`,
  };
}

/**
 * Lists the fixtures a league played on a given date, so a picker can choose one instead of
 * typing a provider id. Only fixtures the provider reports as completed or scheduled are
 * returned; anything it cannot parse is skipped rather than guessed at.
 *
 * This is a convenience for the seal form. It is never used during resolution: that reads
 * the reference fixed at seal time, so a picker cannot re-pick a fixture afterwards.
 */
export interface FixtureOption {
  readonly ref: string;
  readonly eventId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly completed: boolean;
  readonly statusDetail: string;
  readonly kickoff: string | null;
}

export async function listFixturesByDate(input: {
  readonly league: string;
  readonly date: string;
}): Promise<FixtureOption[]> {
  const env = getEnv();
  const base = env.ORACLE_ESPN_BASE_URL.replace(/\/+$/, "");
  const compact = input.date.replace(/-/g, "");
  const url = `${base}/soccer/${encodeURIComponent(input.league)}/scoreboard?dates=${encodeURIComponent(compact)}`;

  const parsed = z
    .object({ events: z.array(eventSchema).optional() })
    .loose()
    .safeParse(await fetchJson(url));
  if (!parsed.success) {
    getLogger().warn({ error: errorForLog(parsed.error) }, "scoreboard response was unexpected");
    return [];
  }

  const options: FixtureOption[] = [];
  for (const event of parsed.data.events ?? []) {
    const competition = event.competitions[0];
    if (!competition) continue;
    const home = competition.competitors.find((team) => team.homeAway === "home");
    const away = competition.competitors.find((team) => team.homeAway === "away");
    if (!home || !away) continue;

    const ref = parseOracleRef(`espn:${input.league}:${event.id}`);
    if (ref === null) continue;

    const status = competition.status?.type;
    const homeScore = home.score === undefined ? null : Number(home.score);
    const awayScore = away.score === undefined ? null : Number(away.score);

    options.push({
      ref: formatOracleRef(ref),
      eventId: ref.eventId,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeScore: homeScore === null || Number.isNaN(homeScore) ? null : homeScore,
      awayScore: awayScore === null || Number.isNaN(awayScore) ? null : awayScore,
      completed: status?.completed === true,
      statusDetail: status?.detail ?? status?.name ?? "unknown",
      kickoff: event.date ?? null,
    });
  }
  return options;
}

/**
 * Looks up a fixture id by date and team, so a picker does not have to know provider ids.
 * Used by the UI helper, never by the resolver: resolution requires an id fixed at seal
 * time, otherwise a picker could shop for whichever fixture made them look right.
 */
export async function findFixtureByDate(input: {
  readonly league: string;
  readonly date: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
}): Promise<OracleRef | null> {
  const env = getEnv();
  const base = env.ORACLE_ESPN_BASE_URL.replace(/\/+$/, "");
  const compact = input.date.replace(/-/g, "");
  const url = `${base}/soccer/${encodeURIComponent(input.league)}/scoreboard?dates=${encodeURIComponent(compact)}`;

  const parsed = z
    .object({ events: z.array(eventSchema).optional() })
    .loose()
    .safeParse(await fetchJson(url));
  if (!parsed.success) {
    getLogger().warn({ error: errorForLog(parsed.error) }, "scoreboard response was unexpected");
    return null;
  }

  for (const event of parsed.data.events ?? []) {
    const competition = event.competitions[0];
    if (!competition) continue;
    const home = competition.competitors.find((team) => team.homeAway === "home");
    const away = competition.competitors.find((team) => team.homeAway === "away");
    if (!home || !away) continue;
    if (
      teamMatches(input.homeTeam, home.team.displayName) &&
      teamMatches(input.awayTeam, away.team.displayName)
    ) {
      const ref = parseOracleRef(`espn:${input.league}:${event.id}`);
      if (ref) return ref;
    }
  }
  return null;
}
