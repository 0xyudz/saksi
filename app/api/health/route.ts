import { handleRoute, jsonResponse } from "@/lib/http";
import { chainHealth } from "@/server/data/chain";
import { databaseHealth } from "@/server/data/health";
import { memoryHealth, relayerUsable } from "@/server/data/memory";

export const dynamic = "force-dynamic";
/** Walrus recall/write and Tatum verification can exceed the platform default. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const [database, walrus, tatum] = await Promise.allSettled([
      databaseHealth(),
      memoryHealth(),
      chainHealth(),
    ]);

    const checks = {
      database: database.status === "fulfilled" ? { ok: true } : { ok: false },
      walrus: walrus.status === "fulfilled" ? { ok: true, ...walrus.value } : { ok: false },
      tatum: tatum.status === "fulfilled" ? { ok: true, ...tatum.value } : { ok: false },
    };

    /*
     * A relayer that answers reads but refuses writes is not healthy for this app: a pick is
     * sealed only if its memory write succeeds, so a paused write path fails every sealing
     * attempt while a read-only health check still returns 200. The rule lives in
     * `relayerUsable()` so it is unit tested rather than inferred here.
     */
    const walrusState =
      walrus.status === "fulfilled"
        ? relayerUsable({ reachable: true, writeReady: walrus.value.writeReady })
        : relayerUsable({ reachable: false, writeReady: null });

    const ok =
      checks.database.ok && checks.tatum.ok && walrusState.ok && walrus.status === "fulfilled";
    return jsonResponse(
      {
        status: ok ? "ok" : "degraded",
        checks: {
          ...checks,
          walrusWritable: walrusState.ok,
          walrusReason: walrusState.reason,
        },
      },
      requestId,
      { status: ok ? 200 : 503 },
    );
  });
}
