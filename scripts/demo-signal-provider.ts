import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import "./load-env";

/**
 * Local implementation of the premium signal provider contract used by
 * `integrations/signals/provider.ts`:
 *
 *   GET /{externalId}
 *   Authorization: Bearer {token}
 *   -> { provider, title, payload }
 *
 * This exists so the ingest -> x402 -> Tatum path can be exercised end to end
 * without pretending a third-party data vendor is connected. The payloads are
 * synthetic and say so. Run with `pnpm demo:provider`.
 */

const PORT = Number(process.env.DEMO_PROVIDER_PORT ?? 4100);
const TOKEN = process.env.DEMO_PROVIDER_TOKEN ?? "demo-token";

interface DemoSignal {
  readonly provider: string;
  readonly title: string;
  readonly payload: Record<string, unknown>;
}

const SIGNALS: Record<string, DemoSignal> = {
  "demo-1": {
    provider: "saksi-demo-provider",
    title: "Demo signal · Arsenal vs Chelsea · match winner",
    payload: {
      selection: "Arsenal to win",
      odds: 1.95,
      confidence: 0.58,
      asOf: "2026-11-02T00:00:00.000Z",
      note: "Synthetic demo payload for the Saksi x402 flow. Not real betting advice.",
    },
  },
  "demo-2": {
    provider: "saksi-demo-provider",
    title: "Demo signal · Lakers vs Celtics · spread",
    payload: {
      selection: "Lakers -3.5",
      odds: 1.91,
      confidence: 0.54,
      asOf: "2026-11-02T00:00:00.000Z",
      note: "Synthetic demo payload for the Saksi x402 flow. Not real betting advice.",
    },
  },
};

function authorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization ?? "";
  const expected = `Bearer ${TOKEN}`;
  const provided = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    send(response, 405, { error: "method not allowed" });
    return;
  }
  if (!authorized(request)) {
    send(response, 401, { error: "missing or invalid bearer token" });
    return;
  }

  const externalId = decodeURIComponent(
    (request.url ?? "/").replace(/^\/+/, "").split("?")[0] ?? "",
  );
  const signal = SIGNALS[externalId];
  if (!signal) {
    send(response, 404, { error: `unknown signal ${externalId || "(empty)"}` });
    return;
  }

  send(response, 200, signal);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      provider: "saksi-demo-provider",
      url: `http://127.0.0.1:${PORT}`,
      ids: Object.keys(SIGNALS),
      note: "Synthetic demo payloads, not third-party data.",
    })}\n`,
  );
});
