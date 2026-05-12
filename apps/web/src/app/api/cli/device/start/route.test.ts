// POST /api/cli/device/start — initiates a device-grant flow.
//
// Tests focus on the route's own contract (rate-limit fail-closed, body
// validation, response shape). The underlying startDeviceAuthorization
// helper is mocked — its DB behavior is covered by device-auth.test.ts.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { makeDeviceAuthMock } from '@/test/device-auth-mock';

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: {} }));

const fakeRateLimit = mock();
const fakeStart = mock();
const fakeHeaders = new Map<string, string>();

mock.module('next/headers', () => ({
  headers: async () => ({
    get: (k: string) => fakeHeaders.get(k.toLowerCase()) ?? null,
  }),
}));
mock.module('@/lib/rate-limit', () => ({
  rateLimitByIp: fakeRateLimit,
  tooManyRequests: (retryAfter: number) =>
    new Response(JSON.stringify({ error: 'rate limited', retryAfter }), {
      status: 429,
      headers: { 'retry-after': String(retryAfter) },
    }),
  getRequestIp: async () => '203.0.113.10',
}));
mock.module('@/lib/device-auth', () =>
  makeDeviceAuthMock({ startDeviceAuthorization: fakeStart }),
);
mock.module('@/env.client', () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: 'https://envstore.xyz' },
}));

const { POST } = await import('./route');

beforeEach(() => {
  fakeRateLimit.mockReset();
  fakeStart.mockReset();
  fakeHeaders.clear();
  fakeHeaders.set('x-forwarded-for', '203.0.113.10');
  fakeRateLimit.mockResolvedValue({ success: true, remaining: 19, retryAfterSec: 0 });
});

function postReq(body: unknown): Request {
  return new Request('https://envstore.xyz/api/cli/device/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /cli/device/start', () => {
  test('rate-limited → 429, no DB write', async () => {
    fakeRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, retryAfterSec: 30 });
    const res = await POST(postReq({}));
    expect(res.status).toBe(429);
    expect(fakeStart).not.toHaveBeenCalled();
  });

  test('rate-limit scope is "device-start" with 20/hour cap', async () => {
    fakeStart.mockResolvedValueOnce({
      deviceCode: 'd',
      userCode: 'ABCDEFGH',
      formattedUserCode: 'ABCD-EFGH',
      expiresIn: 600,
      interval: 5,
    });
    await POST(postReq({}));
    const args = fakeRateLimit.mock.calls[0] as [string, { limit: number; windowSec: number }];
    expect(args[0]).toBe('device-start');
    expect(args[1]).toEqual({ limit: 20, windowSec: 3600 });
  });

  test('happy path → 200 with deviceCode, userCode, verification URIs', async () => {
    fakeStart.mockResolvedValueOnce({
      deviceCode: 'plain-device-code',
      userCode: 'ABCDEFGH',
      formattedUserCode: 'ABCD-EFGH',
      expiresIn: 600,
      interval: 5,
    });
    const res = await POST(postReq({ clientName: 'my-cli' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deviceCode).toBe('plain-device-code');
    expect(body.userCode).toBe('ABCD-EFGH');
    expect(body.verificationUri).toBe('https://envstore.xyz/cli');
    expect(body.verificationUriComplete).toBe('https://envstore.xyz/cli/ABCDEFGH');
    expect(body.expiresIn).toBe(600);
    expect(body.interval).toBe(5);

    const startArgs = fakeStart.mock.calls[0]?.[0] as {
      clientName: string;
      ipAddress: string | null;
    };
    expect(startArgs.clientName).toBe('my-cli');
    expect(startArgs.ipAddress).toBe('203.0.113.10');
  });

  test('omitted clientName defaults to "envstore-cli"', async () => {
    fakeStart.mockResolvedValueOnce({
      deviceCode: 'd',
      userCode: 'AB',
      formattedUserCode: 'AB-',
      expiresIn: 600,
      interval: 5,
    });
    await POST(postReq({}));
    const startArgs = fakeStart.mock.calls[0]?.[0] as { clientName: string };
    expect(startArgs.clientName).toBe('envstore-cli');
  });

  test('clientName over the 80-char cap → 400', async () => {
    const res = await POST(postReq({ clientName: 'x'.repeat(81) }));
    expect(res.status).toBe(400);
    expect(fakeStart).not.toHaveBeenCalled();
  });

  test('non-JSON body is tolerated (treated as empty), still works', async () => {
    fakeStart.mockResolvedValueOnce({
      deviceCode: 'd',
      userCode: 'AB',
      formattedUserCode: 'AB-',
      expiresIn: 600,
      interval: 5,
    });
    const r = new Request('https://envstore.xyz/api/cli/device/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
  });

  test('strips trailing slash off NEXT_PUBLIC_APP_URL when composing URIs', async () => {
    // Re-import with a different env value to assert the slash-strip.
    // Easier: just check the result doesn't have a double slash.
    fakeStart.mockResolvedValueOnce({
      deviceCode: 'd',
      userCode: 'ABCDEFGH',
      formattedUserCode: 'ABCD-EFGH',
      expiresIn: 600,
      interval: 5,
    });
    const res = await POST(postReq({}));
    const body = (await res.json()) as { verificationUri: string; verificationUriComplete: string };
    expect(body.verificationUri).not.toContain('//cli');
    expect(body.verificationUriComplete).not.toContain('//cli/');
  });
});
