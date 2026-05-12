// In-memory sliding-window limiter tests.
//
// The bucket map is module-level state, so every test scopes itself to a
// fresh key prefix. We don't mess with timers — `Date.now()` is plenty and
// keeps the assertions straightforward.

import { describe, expect, mock, test } from 'bun:test';

import { makeEnvMock } from '@/test/env-mock';

mock.module('server-only', () => ({}));

const fakeHeaders = new Map<string, string>();
mock.module('next/headers', () => ({
  headers: async () => ({
    get: (k: string) => fakeHeaders.get(k.toLowerCase()) ?? null,
  }),
}));

// Default rate-limit env: 1 trusted proxy hop, no override header. Tests that
// need different values override per-block via fakeEnv mutation.
const fakeEnv: Record<string, unknown> = {
  TRUSTED_PROXY_HOPS: 1,
  RATE_LIMIT_IP_HEADER: undefined,
};
mock.module('@/env', () => makeEnvMock({ env: fakeEnv }));

const { rateLimit, rateLimitByIp, getRequestIp, tooManyRequests } = await import(
  './rate-limit'
);

// Per-test unique scope so module-level state doesn't bleed between cases.
let scopeCounter = 0;
function uniqueKey(label: string): string {
  scopeCounter += 1;
  return `${label}:${scopeCounter}:${Math.random().toString(36).slice(2, 8)}`;
}

describe('rateLimit', () => {
  test('first call within limit → success, remaining decrements correctly', () => {
    const key = uniqueKey('basic');
    const r1 = rateLimit(key, { limit: 3, windowSec: 60 });
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);
    const r2 = rateLimit(key, { limit: 3, windowSec: 60 });
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);
    const r3 = rateLimit(key, { limit: 3, windowSec: 60 });
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  test('exceeding the limit → 429 with positive retryAfter', () => {
    const key = uniqueKey('exceed');
    for (let i = 0; i < 5; i++) rateLimit(key, { limit: 5, windowSec: 60 });
    const blocked = rateLimit(key, { limit: 5, windowSec: 60 });
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    // retryAfter is at least 1 second and at most the window.
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  test('keys are isolated — distinct IPs do not share a bucket', () => {
    const a = uniqueKey('iso-a');
    const b = uniqueKey('iso-b');
    rateLimit(a, { limit: 1, windowSec: 60 });
    // a is now at its limit; b should still have full capacity.
    const blockedA = rateLimit(a, { limit: 1, windowSec: 60 });
    const okB = rateLimit(b, { limit: 1, windowSec: 60 });
    expect(blockedA.success).toBe(false);
    expect(okB.success).toBe(true);
  });

  test('shrinking the limit retroactively still triggers a block', () => {
    const key = uniqueKey('retro');
    for (let i = 0; i < 4; i++) rateLimit(key, { limit: 10, windowSec: 60 });
    // Subsequent call with a tighter limit still respects the existing
    // bucket contents — limit shrinks immediately, doesn't wait for reset.
    const blocked = rateLimit(key, { limit: 3, windowSec: 60 });
    expect(blocked.success).toBe(false);
  });
});

describe('tooManyRequests', () => {
  test('serializes 429 with retry-after header and JSON body', async () => {
    const res = tooManyRequests(42);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.retryAfter).toBe(42);
    expect(body.error).toMatch(/too many requests/i);
  });
});

describe('getRequestIp', () => {
  test('reads x-forwarded-for from the RIGHT — closest to the trust boundary', async () => {
    // Default TRUSTED_PROXY_HOPS=1. With a chain
    //   `<client>, <upstream-proxy>, <our-proxy>`
    // we want our proxy's view of the upstream — that's the last entry,
    // which is what the trust boundary directly observed. Reading the
    // first entry was the legacy behavior and let an untrusted appender
    // spoof the rate-limit key.
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', '203.0.113.10, 198.51.100.1, 10.0.0.1');
    expect(await getRequestIp()).toBe('10.0.0.1');
  });

  test('single-IP x-forwarded-for returns that IP', async () => {
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', '203.0.113.5');
    expect(await getRequestIp()).toBe('203.0.113.5');
  });

  test('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    fakeHeaders.clear();
    fakeHeaders.set('x-real-ip', '198.51.100.42');
    expect(await getRequestIp()).toBe('198.51.100.42');
  });

  test('returns null when neither header present', async () => {
    fakeHeaders.clear();
    expect(await getRequestIp()).toBeNull();
  });

  test('respects TRUSTED_PROXY_HOPS=2 (two trusted proxies in front)', async () => {
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', '203.0.113.10, 198.51.100.1, 10.0.0.1');
    fakeEnv.TRUSTED_PROXY_HOPS = 2;
    try {
      // With 2 hops, the "real" client IP is the 2nd-from-right: 198.51.100.1.
      expect(await getRequestIp()).toBe('198.51.100.1');
    } finally {
      fakeEnv.TRUSTED_PROXY_HOPS = 1;
    }
  });

  test('RATE_LIMIT_IP_HEADER overrides x-forwarded-for parsing entirely', async () => {
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', 'attacker, 10.0.0.1');
    fakeHeaders.set('cf-connecting-ip', '198.51.100.99');
    fakeEnv.RATE_LIMIT_IP_HEADER = 'cf-connecting-ip';
    try {
      expect(await getRequestIp()).toBe('198.51.100.99');
    } finally {
      fakeEnv.RATE_LIMIT_IP_HEADER = undefined;
    }
  });

  test('untrusted appender to x-forwarded-for cannot spoof the IP (regression for H-3)', async () => {
    // With TRUSTED_PROXY_HOPS=1 (one proxy between us and the public
    // internet), the only trustworthy IP is the rightmost — written by
    // that proxy. The leftmost entry is whatever the client claimed. An
    // attacker rotating the leftmost IP must not bypass per-IP limits.
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', '1.1.1.1, 10.0.0.1');
    const first = await getRequestIp();
    fakeHeaders.set('x-forwarded-for', '2.2.2.2, 10.0.0.1');
    const second = await getRequestIp();
    expect(first).toBe('10.0.0.1');
    expect(second).toBe('10.0.0.1');
  });
});

describe('rateLimitByIp', () => {
  test('limits independently per IP', async () => {
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', '203.0.113.1');
    const scope = uniqueKey('ip-scope');
    const r1 = await rateLimitByIp(scope, { limit: 1, windowSec: 60 });
    const r2 = await rateLimitByIp(scope, { limit: 1, windowSec: 60 });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);

    fakeHeaders.set('x-forwarded-for', '203.0.113.2');
    const r3 = await rateLimitByIp(scope, { limit: 1, windowSec: 60 });
    expect(r3.success).toBe(true);
  });

  test('missing IP buckets together as "anon" (stricter than per-IP)', async () => {
    fakeHeaders.clear();
    const scope = uniqueKey('anon');
    const r1 = await rateLimitByIp(scope, { limit: 1, windowSec: 60 });
    const r2 = await rateLimitByIp(scope, { limit: 1, windowSec: 60 });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
  });
});
