import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import type { z } from "zod";

import { AppError, publicError, toAppError, validationError } from "./errors";
import { getEnv } from "./env";
import { errorForLog, loggerFor } from "./logger";
import { REQUEST_ID_HEADER } from "./config";

export interface RouteContext<TRequest extends Request = Request> {
  readonly requestId: string;
  readonly logger: Logger;
  readonly request: TRequest;
}

function headerRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  if (incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)) return incoming;
  return randomUUID();
}

export function jsonResponse(body: unknown, requestId: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export async function handleRoute<TRequest extends Request>(
  request: TRequest,
  handler: (context: RouteContext<TRequest>) => Promise<Response>,
): Promise<Response> {
  const requestId = headerRequestId(request);
  const logger = loggerFor(requestId);
  const startedAt = Date.now();

  try {
    const response = await handler({ request, requestId, logger });
    logger.info(
      {
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      },
      "request completed",
    );
    return response;
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      {
        method: request.method,
        path: new URL(request.url).pathname,
        status: appError.httpStatus,
        code: appError.code,
        durationMs: Date.now() - startedAt,
        error: errorForLog(appError.cause ?? appError),
      },
      "request failed",
    );
    return jsonResponse(publicError(appError, requestId), requestId, {
      status: appError.httpStatus,
    });
  }
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await request.text();
  if (raw.length === 0) {
    throw new AppError("VALIDATION_FAILED", "A JSON body is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "The request body is not valid JSON.", {
      cause: error,
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const url = new URL(request.url);
  const entries: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) entries[key] = value;

  const result = schema.safeParse(entries);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * State-changing routes only accept same-origin browser requests. Agents calling the
 * API directly may omit Origin, but a mismatched Origin is always rejected.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const allowed = new URL(getEnv().APP_BASE_URL).origin;
  if (origin !== allowed) {
    throw new AppError("FORBIDDEN", "Cross-origin requests are not allowed.");
  }
}
