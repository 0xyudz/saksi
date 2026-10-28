import { AppError } from "@/lib/errors";

/**
 * Minimal in-memory, per-instance rate limiter. It is deliberately not a replacement
 * for an edge or gateway limiter: each server instance keeps its own counters and a
 * restart clears them. It exists to blunt accidental or opportunistic floods without
 * adding Redis/Upstash as a dependency.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function prune(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function assertWithinRateLimit(
  request: Request,
  name: string,
  limit: number,
  windowMs: number,
): void {
  const now = Date.now();
  const key = `${name}:${clientAddress(request)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    prune(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new AppError("RATE_LIMITED", "Too many requests; try again shortly.");
  }
  bucket.count += 1;
}
