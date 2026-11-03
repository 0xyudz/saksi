import { z } from "zod";

import {
  listFixturesByDate,
  SUPPORTED_LEAGUE,
  SUPPORTED_LEAGUE_LABEL,
} from "@/integrations/oracle/results";
import { getEnv } from "@/lib/env";
import { handleRoute, jsonResponse, parseQuery } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { requireApiUserId } from "@/server/auth";

export const dynamic = "force-dynamic";
/** The results provider is read live, so allow more than the platform default. */
export const maxDuration = 30;

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  league: z.literal(SUPPORTED_LEAGUE).default(SUPPORTED_LEAGUE),
});

/**
 * Fixtures for the one league Saksi can independently verify.
 *
 * Returning a list rather than a free-text id field is deliberate: the oracle reference is
 * fixed at seal time and read verbatim at resolution, so the picker should choose from
 * fixtures the provider actually reported rather than type an id from memory.
 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    await requireApiUserId();
    assertWithinRateLimit(request, "oracle:fixtures", 30, 60_000);

    const query = parseQuery(request, querySchema);
    if (!getEnv().ORACLE_ENABLED) {
      return jsonResponse(
        { league: SUPPORTED_LEAGUE, leagueLabel: SUPPORTED_LEAGUE_LABEL, fixtures: [] },
        requestId,
      );
    }

    const fixtures = await listFixturesByDate({ league: query.league, date: query.date });

    return jsonResponse(
      { league: SUPPORTED_LEAGUE, leagueLabel: SUPPORTED_LEAGUE_LABEL, fixtures },
      requestId,
    );
  });
}
