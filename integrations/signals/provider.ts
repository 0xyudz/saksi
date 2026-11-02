import { z } from "zod";

import type { JsonObject } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toJsonObject } from "@/lib/json";

const providerResponseSchema = z
  .object({
    provider: z.string().min(1).max(120),
    title: z.string().min(1).max(300),
    payload: z.unknown(),
  })
  .loose();

export interface ProviderSignal {
  readonly provider: string;
  readonly title: string;
  readonly payload: JsonObject;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Maps a provider HTTP status onto the error Saksi should raise. Pure so it can be tested
 * without a network: blaming the provider (502) for a bad external id used to hide the real
 * cause from the operator, and only a 5xx is genuinely worth retrying.
 */
export function providerStatusError(status: number, externalId: string): AppError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 404) {
    return new AppError("NOT_FOUND", `The signal provider has no signal "${externalId}".`);
  }
  if (status === 401 || status === 403) {
    return new AppError(
      "SERVICE_UNAVAILABLE",
      `The signal provider rejected the configured credentials (${status}).`,
    );
  }
  if (status >= 400 && status < 500) {
    return new AppError(
      "VALIDATION_FAILED",
      `The signal provider rejected the request (${status}).`,
    );
  }
  return new AppError("UPSTREAM_UNAVAILABLE", `The signal provider responded ${status}.`, {
    retryable: true,
  });
}

/**
 * The premium data provider contract is intentionally small:
 *   GET {SIGNAL_PROVIDER_API_URL}/{externalId}
 *   Authorization: Bearer {SIGNAL_PROVIDER_API_KEY}
 *   -> { provider, title, payload }
 *
 * Without both env variables the feature is disabled loudly (503), never faked.
 */
export async function fetchProviderSignal(externalId: string): Promise<ProviderSignal> {
  const env = getEnv();
  if (!env.SIGNAL_PROVIDER_API_URL || !env.SIGNAL_PROVIDER_API_KEY) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "SIGNAL_PROVIDER_API_URL and SIGNAL_PROVIDER_API_KEY are not configured.",
    );
  }

  const base = env.SIGNAL_PROVIDER_API_URL.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(externalId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${env.SIGNAL_PROVIDER_API_KEY}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The signal provider is unreachable.", {
      cause: error,
      retryable: true,
    });
  }

  if (!response.ok) {
    const error = providerStatusError(response.status, externalId);
    if (error) throw error;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The signal provider returned invalid JSON.", {
      cause: error,
    });
  }

  const parsed = providerResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The signal provider response does not match the agreed contract.",
      { cause: parsed.error },
    );
  }

  return {
    provider: parsed.data.provider,
    title: parsed.data.title,
    payload: toJsonObject(parsed.data.payload),
  };
}
