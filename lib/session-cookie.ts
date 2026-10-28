import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The session cookie is `<userId>.<base64url(hmacSha256(userId, SESSION_SECRET))>`.
 * The secret never travels in the cookie, and verification is constant-time for the
 * signature bytes.
 */

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function signatureFor(userId: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(userId, "utf8").digest();
}

export function signSession(userId: string, secret: string): string {
  return `${userId}.${signatureFor(userId, secret).toString("base64url")}`;
}

export function verifySession(value: string, secret: string): string | null {
  if (value.length === 0) return null;

  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;

  const userId = value.slice(0, separator);
  const encoded = value.slice(separator + 1);
  if (!SIGNATURE_PATTERN.test(encoded)) return null;

  const provided = Buffer.from(encoded, "base64url");
  const expected = signatureFor(userId, secret);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return userId;
}
