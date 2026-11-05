import { z } from "zod";

export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_NOT_VERIFIED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "INTERNAL";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYMENT_REQUIRED: 402,
  PAYMENT_NOT_VERIFIED: 402,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  SERVICE_UNAVAILABLE: 503,
  CONFIGURATION_ERROR: 500,
  INTERNAL: 500,
};

export type AppErrorDetails = ReadonlyArray<{ path: string; message: string }>;

export interface AppErrorOptions {
  readonly cause?: unknown;
  readonly details?: AppErrorDetails;
  readonly httpStatus?: number;
  /** Marks a failure that a caller may safely retry (transport/5xx only). */
  readonly retryable?: boolean;
  /**
   * Headers the error response must still carry. Used when a payment already settled and
   * the failure happened afterwards: the client needs the settlement receipt to recover
   * rather than pay a second time.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details?: AppErrorDetails;
  readonly retryable: boolean;
  readonly headers?: Readonly<Record<string, string>>;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? HTTP_STATUS[code];
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.headers = options.headers;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function validationError(error: z.ZodError): AppError {
  return new AppError("VALIDATION_FAILED", "The request payload is invalid.", {
    cause: error,
    details: error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    })),
  });
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof z.ZodError) return validationError(value);
  if (value instanceof Error) {
    return new AppError("INTERNAL", "An unexpected error occurred.", { cause: value });
  }
  return new AppError("INTERNAL", "An unexpected error occurred.", { cause: value });
}

export interface PublicErrorBody {
  readonly error: {
    readonly code: AppErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: AppErrorDetails;
  };
}

export function publicError(error: AppError, requestId: string): PublicErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
