import { assertSameOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { formatAtomic } from "@/lib/price";
import { requireApiUserId } from "@/server/auth";
import { listSignals } from "@/server/data/signals";
import { ingestSignal, ingestSignalSchema } from "@/server/usecases/ingest-signal";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const items = await listSignals();
    return jsonResponse(
      {
        signals: items.map((item) => ({
          id: item.signal.id,
          provider: item.signal.provider,
          title: item.signal.title,
          priceAtomic: item.signal.priceAtomic.toString(),
          priceUsd: formatAtomic(item.signal.priceAtomic),
          asset: item.signal.asset,
          purchases: item.purchases,
          createdAt: item.signal.createdAt.toISOString(),
        })),
      },
      requestId,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    await requireApiUserId();
    const input = await parseJsonBody(request, ingestSignalSchema);
    const signal = await ingestSignal(input);
    return jsonResponse(
      {
        signal: {
          id: signal.id,
          provider: signal.provider,
          title: signal.title,
          priceAtomic: signal.priceAtomic.toString(),
        },
      },
      requestId,
      { status: 201 },
    );
  });
}
