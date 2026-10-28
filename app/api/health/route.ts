import { handleRoute, jsonResponse } from "@/lib/http";
import { chainHealth } from "@/server/data/chain";
import { databaseHealth } from "@/server/data/health";
import { memoryHealth } from "@/server/data/memory";

export const dynamic = "force-dynamic";

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

    const ok = checks.database.ok && checks.walrus.ok && checks.tatum.ok;
    return jsonResponse({ status: ok ? "ok" : "degraded", checks }, requestId, {
      status: ok ? 200 : 503,
    });
  });
}
