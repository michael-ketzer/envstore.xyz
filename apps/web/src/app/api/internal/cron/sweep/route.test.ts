// GET /api/internal/cron/sweep — the cron-triggered retention hard-delete.
//
// Two safety gates we pin explicitly:
//   1. If CRON_SECRET is not configured, the route refuses to run AT ALL
//      (503). A misconfigured deployment must NOT silently start deleting.
//   2. Bearer must match `Bearer ${CRON_SECRET}` exactly; the x-vercel-cron
//      header is intentionally ignored.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { makeEnvMock } from '@/test/env-mock';

const fakeRunSweep = mock();
const fakeEnv = { CRON_SECRET: 'secret-abc' as string | undefined };

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: {} }));
mock.module('@/env', () => makeEnvMock({ env: fakeEnv }));
mock.module('@/lib/retention-sweep', () => ({ runRetentionSweep: fakeRunSweep }));

const { GET } = await import('./route');

beforeEach(() => {
  fakeRunSweep.mockReset();
  fakeEnv.CRON_SECRET = 'secret-abc';
});

function req(bearer: string | null): Request {
  const headers: Record<string, string> = {};
  if (bearer !== null) headers.authorization = bearer;
  return new Request('https://envstore.xyz/api/internal/cron/sweep', { method: 'GET', headers });
}

describe('GET /api/internal/cron/sweep', () => {
  test('CRON_SECRET unset → 503, sweep does NOT run', async () => {
    fakeEnv.CRON_SECRET = undefined;
    const res = await GET(req('Bearer anything'));
    expect(res.status).toBe(503);
    expect(fakeRunSweep).not.toHaveBeenCalled();
  });

  test('missing bearer → 401, sweep does NOT run', async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    expect(fakeRunSweep).not.toHaveBeenCalled();
  });

  test('wrong bearer → 401', async () => {
    const res = await GET(req('Bearer not-the-secret'));
    expect(res.status).toBe(401);
    expect(fakeRunSweep).not.toHaveBeenCalled();
  });

  test('matching bearer → 200, sweep result echoed', async () => {
    fakeRunSweep.mockResolvedValueOnce({
      workspaces: 1,
      projects: 2,
      groups: 0,
      environments: 1,
      versions: 5,
      r2Skipped: false,
    });
    const res = await GET(req('Bearer secret-abc'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      workspaces: 1,
      projects: 2,
      groups: 0,
      environments: 1,
      versions: 5,
      r2Skipped: false,
    });
  });

  test('x-vercel-cron header alone is NOT a credential (must still match bearer)', async () => {
    const r = new Request('https://envstore.xyz/api/internal/cron/sweep', {
      method: 'GET',
      headers: { 'x-vercel-cron': '1' },
    });
    const res = await GET(r);
    expect(res.status).toBe(401);
    expect(fakeRunSweep).not.toHaveBeenCalled();
  });
});
