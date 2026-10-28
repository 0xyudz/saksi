import pino, { type Logger } from "pino";

import { getEnv } from "./env";

const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "*.privateKey",
  "*.apiKey",
  "*.secret",
  "*.authorization",
  "*.signature",
  "raw",
];

let root: Logger | undefined;

export function getLogger(): Logger {
  if (root) return root;

  const env = getEnv();
  root = pino({
    level: env.LOG_LEVEL,
    base: { service: "saksi" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });

  return root;
}

export function loggerFor(requestId: string): Logger {
  return getLogger().child({ requestId });
}

export function errorForLog(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: "UnknownError", message: String(error) };
}
