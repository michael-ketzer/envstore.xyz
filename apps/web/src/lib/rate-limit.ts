// In-memory sliding-window rate limiter.
//
// Sized for single-instance deployments (Vercel, Fly, etc. with one region/one
// instance). For horizontally-scaled deploys, swap the storage for Upstash
// Redis without touching the call sites — the API surface stays the same.

import 'server-only';
import { headers } from 'next/headers';

import { env } from '@/env';

type Bucket = number[]; // timestamps (ms)

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

const SWEEP_INTERVAL_MS = 60_000;
// Stale-bucket cutoff: drop buckets whose newest entry is older than this.
const STALE_THRESHOLD_MS = 60 * 60_000;
// Hard cap on distinct bucket keys held in memory. An attacker varying the
// trusted-proxy hop header (or rotating real client IPs in a botnet) could
// otherwise grow this map until the process OOMs. When we exceed the cap,
// we drop the oldest bucket on insert — degrades gracefully to a smaller
// effective rate-limit window for the most-stale offenders, but keeps
// memory bounded.
const MAX_BUCKETS = 50_000;

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

// When the bucket map is at capacity, drop the bucket whose newest entry is
// oldest. O(n) but only runs when we hit the cap and the map is bounded.
function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, bucket] of buckets) {
    const last = bucket[bucket.length - 1] ?? 0;
    if (last < oldestTs) {
      oldestTs = last;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) buckets.delete(oldestKey);
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
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    evictOldest();
  }
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

// Resolve the client IP from request headers. The naive "first entry of
// x-forwarded-for" is unsafe: clients can prepend anything they want, and
// any proxy that APPENDS instead of REPLACES the header lets an attacker
// spoof a fake first IP to bypass per-IP rate limits.
//
// We support two configurations:
//
//   1. `RATE_LIMIT_IP_HEADER` set (e.g. `cf-connecting-ip` on Cloudflare,
//      `x-real-ip` on a single-proxy Vercel setup): trust that exact header
//      verbatim. The named header is whatever the trust boundary sets.
//
//   2. Otherwise: parse x-forwarded-for as a comma-separated chain and
//      take the (TRUSTED_PROXY_HOPS + 1)-th entry FROM THE RIGHT. With the
//      default `TRUSTED_PROXY_HOPS=1`, that's the rightmost IP — the one
//      written by the single trusted proxy directly in front of us.
//      Anything to the LEFT of that index is untrusted (client-controlled
//      or written by a proxy further upstream we don't trust).
//
// Returns null when no header is present; rateLimitByIp will fall back to
// the stricter shared "anon" bucket.
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();

  if (env.RATE_LIMIT_IP_HEADER) {
    const v = h.get(env.RATE_LIMIT_IP_HEADER.toLowerCase());
    if (v) return v.trim() || null;
    return null;
  }

  const fwd = h.get('x-forwarded-for');
  if (fwd) {
    const ips = fwd
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ips.length === 0) return null;
    // Index from the right: hops=1 → last entry (set by our single proxy).
    const idx = Math.max(0, ips.length - env.TRUSTED_PROXY_HOPS);
    return ips[idx] ?? null;
  }
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
