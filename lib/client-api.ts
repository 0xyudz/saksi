import { z } from "zod";

const errorBodySchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        requestId: z.string().optional(),
        details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
      })
      .loose(),
  })
  .loose();

export class ApiRequestError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(message: string, code: string, requestId?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.requestId = requestId;
  }
}

export async function requestJson<T>(input: {
  readonly url: string;
  readonly schema: z.ZodType<T>;
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers:
        input.body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error ? error.message : "Network request failed.",
      "NETWORK",
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiRequestError("Response was not valid JSON.", "INVALID_RESPONSE");
    }
  }

  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    if (parsed.success) {
      throw new ApiRequestError(
        parsed.data.error.message,
        parsed.data.error.code,
        parsed.data.error.requestId,
      );
    }
    throw new ApiRequestError(`Request failed with status ${response.status}.`, "HTTP_ERROR");
  }

  const parsed = input.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError("The server returned an unexpected response.", "INVALID_RESPONSE");
  }
  return parsed.data;
}
