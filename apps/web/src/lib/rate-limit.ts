// In-memory sliding-window rate limiter.
//
// Sized for single-instance deployments (Vercel, Fly, etc. with one region/one
// instance). For horizontally-scaled deploys, swap the storage for Upstash
// Redis without touching the call sites — the API surface stays the same.

import 'server-only';
import { headers } from 'next/headers';

type Bucket = number[]; // timestamps (ms)

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

const SWEEP_INTERVAL_MS = 60_000;
// Stale-bucket cutoff: drop buckets whose newest entry is older than this.
const STALE_THRESHOLD_MS = 60 * 60_000;

// Lazy garbage collection — runs at most once per minute, regardless of how
// many limit() calls fire in between.
function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    const last = bucket[bucket.length - 1];
    if (last === undefined || last < now - STALE_THRESHOLD_MS) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  retryAfterSec: number;
};

export type RateLimitOptions = {
  /** Maximum requests permitted in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
};

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const windowMs = opts.windowSec * 1000;
  const existing = buckets.get(key) ?? [];
  // Drop timestamps that fell out of the window.
  const recent: number[] = [];
  for (const t of existing) if (t > now - windowMs) recent.push(t);

  if (recent.length >= opts.limit) {
    const oldest = recent[0]!;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(key, recent);
    return { success: false, remaining: 0, retryAfterSec };
  }
  recent.push(now);
  buckets.set(key, recent);
  return {
    success: true,
    remaining: opts.limit - recent.length,
    retryAfterSec: 0,
  };
}

// Convenience: pull the client IP from request headers (proxy-aware) and
// rate-limit on that. Falls back to a fixed "anon" bucket when no IP is
// detectable — stricter than IP-tied limits, to discourage spoofing.
export async function rateLimitByIp(
  scope: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const ip = await getRequestIp();
  return rateLimit(`${scope}:ip:${ip ?? 'anon'}`, opts);
}

export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return h.get('x-real-ip') ?? null;
}

// Helper for routes: 429 response with Retry-After honored.
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down.',
      retryAfter: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(retryAfterSec),
      },
    },
  );
}
