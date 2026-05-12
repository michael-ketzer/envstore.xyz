// POST /api/cli/device/poll — RFC 8628 polling endpoint.
//
// The route is a thin contract over pollDeviceAuthorization. We pin: rate
// limit fail-closed (no DB poll on 429), body validation, and the five
// status responses ('pending', 'slow_down', 'approved', 'denied',
// 'expired') get mapped onto the wire format the CLI expects.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { makeDeviceAuthMock } from '@/test/device-auth-mock';

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: {} }));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));

const fakeRateLimit = mock();
const fakePoll = mock();

mock.module('@/lib/rate-limit', () => ({
  rateLimitByIp: fakeRateLimit,
  tooManyRequests: (retryAfter: number) =>
    new Response(JSON.stringify({ error: 'rate limited', retryAfter }), {
      status: 429,
    }),
  getRequestIp: async () => null,
}));
mock.module('@/lib/device-auth', () =>
  makeDeviceAuthMock({ pollDeviceAuthorization: fakePoll }),
);

const { POST } = await import('./route');

beforeEach(() => {
  fakeRateLimit.mockReset();
  fakePoll.mockReset();
  fakeRateLimit.mockResolvedValue({ success: true, remaining: 119, retryAfterSec: 0 });
});

function postReq(body: unknown): Request {
  return new Request('https://envstore.xyz/api/cli/device/poll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_DEVICE_CODE = 'd'.repeat(40);

describe('POST /cli/device/poll', () => {
  test('rate-limited → 429, no DB lookup', async () => {
    fakeRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, retryAfterSec: 1 });
    const res = await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    expect(res.status).toBe(429);
    expect(fakePoll).not.toHaveBeenCalled();
  });

  test('rate-limit scope is "device-poll" with 120/min cap', async () => {
    fakePoll.mockResolvedValueOnce({ kind: 'pending' });
    await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    const args = fakeRateLimit.mock.calls[0] as [string, { limit: number; windowSec: number }];
    expect(args[0]).toBe('device-poll');
    expect(args[1]).toEqual({ limit: 120, windowSec: 60 });
  });

  test('invalid JSON → 400, no poll', async () => {
    const r = new Request('https://envstore.xyz/api/cli/device/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(r);
    expect(res.status).toBe(400);
    expect(fakePoll).not.toHaveBeenCalled();
  });

  test('deviceCode too short → 400', async () => {
    const res = await POST(postReq({ deviceCode: 'x' }));
    expect(res.status).toBe(400);
    expect(fakePoll).not.toHaveBeenCalled();
  });

  test('pending → {status: "pending"}', async () => {
    fakePoll.mockResolvedValueOnce({ kind: 'pending' });
    const res = await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  test('slow_down → {status: "slow_down", interval}', async () => {
    fakePoll.mockResolvedValueOnce({ kind: 'slow_down', interval: 10 });
    const res = await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    expect(await res.json()).toEqual({ status: 'slow_down', interval: 10 });
  });

  test('approved → {status: "approved", token}', async () => {
    fakePoll.mockResolvedValueOnce({ kind: 'approved', token: 'cli-token-cleartext' });
    const res = await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    expect(await res.json()).toEqual({ status: 'approved', token: 'cli-token-cleartext' });
  });

  test('denied → {status: "denied"} (200, not 401 — RFC 8628 stays 200)', async () => {
    fakePoll.mockResolvedValueOnce({ kind: 'denied' });
    const res = await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'denied' });
  });

  test('expired → {status: "expired"}', async () => {
    fakePoll.mockResolvedValueOnce({ kind: 'expired' });
    const res = await POST(postReq({ deviceCode: VALID_DEVICE_CODE }));
    expect(await res.json()).toEqual({ status: 'expired' });
  });
});
