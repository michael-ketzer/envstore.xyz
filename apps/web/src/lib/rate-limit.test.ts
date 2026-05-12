// In-memory sliding-window limiter tests.
//
// The bucket map is module-level state, so every test scopes itself to a
// fresh key prefix. We don't mess with timers — `Date.now()` is plenty and
// keeps the assertions straightforward.

import { describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const fakeHeaders = new Map<string, string>();
mock.module('next/headers', () => ({
  headers: async () => ({
    get: (k: string) => fakeHeaders.get(k.toLowerCase()) ?? null,
  }),
}));

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
  test('prefers x-forwarded-for first hop', async () => {
    fakeHeaders.clear();
    fakeHeaders.set('x-forwarded-for', '203.0.113.10, 198.51.100.1, 10.0.0.1');
    expect(await getRequestIp()).toBe('203.0.113.10');
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
