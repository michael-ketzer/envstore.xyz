// POST /api/v1/link-codes/redeem — bind a CLI to a project via setup code.
//
// Key invariants:
//   - Rate-limit fires BEFORE auth (cheap rejection of brute-force).
//   - User-auth only (workspace tokens cannot redeem on behalf of a user).
//   - Both "code doesn't exist" and "code exists, you're not a member" return
//     a uniform 404 + uniform message. Distinguishing them is a (computationally
//     inert) info leak; we collapse them so the API can't be used to oracle
//     code validity outside the caller's own workspaces.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

const fakeRateLimit = mock();
const fakeRedeem = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@/lib/rate-limit', () => ({
  rateLimitByIp: fakeRateLimit,
  tooManyRequests: (retryAfter: number) =>
    new Response(JSON.stringify({ error: 'rate limited', retryAfter }), {
      status: 429,
    }),
}));
// Mock the dedicated `@/lib/project-link-codes-redeem` re-export — that
// path is used ONLY by route.ts and by this test, so the mock can't
// collide with `projects.test.ts`'s mock of `./project-link-codes`
// (Bun's `mock.module` cache is global and first-wins).
mock.module('@/lib/project-link-codes-redeem', () => ({
  redeemLinkCode: fakeRedeem,
}));

const { POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeRateLimit.mockReset();
  fakeRedeem.mockReset();
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakeRateLimit.mockResolvedValue({ success: true, remaining: 19, retryAfterSec: 0 });
});

async function stageUserAuth(bearer: string) {
  const tokenHash = await sha256Hex(bearer);
  fakePrisma.cliToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
    if (args.where.tokenHash !== tokenHash) return null;
    return {
      id: 'tok_1',
      userId: 'u_1',
      name: 'cli',
      tokenHash,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      user: {
        id: 'u_1',
        email: 'alice@example.com',
        name: null,
        emailVerified: new Date(),
        image: null,
        paddleCustomerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  });
}

async function stageWorkspaceTokenAuth(bearer: string) {
  const tokenHash = await sha256Hex(bearer);
  fakePrisma.workspaceToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
    if (args.where.tokenHash !== tokenHash) return null;
    return {
      id: 'wstok_1',
      workspaceId: 'ws_1',
      name: 'ci',
      tokenHash,
      recipient: 'age1stub',
      recipientKind: 'AGE_X25519',
      scopes: ['read', 'write'],
      scopedProjectIds: [],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdByUserId: 'u_admin',
      createdAt: new Date(),
    };
  });
}

function postReq(bearer: string, body: unknown): Request {
  return new Request('https://envstore.xyz/api/v1/link-codes/redeem', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /link-codes/redeem', () => {
  test('rate-limited BEFORE auth → 429, no DB lookups at all', async () => {
    fakeRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, retryAfterSec: 30 });
    const res = await POST(postReq('user-bearer', { code: 'ABCD-EFGH' }));
    expect(res.status).toBe(429);
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
    expect(fakeRedeem).not.toHaveBeenCalled();
  });

  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/link-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'X' }),
    });
    expect((await POST(r)).status).toBe(401);
    expect(fakeRedeem).not.toHaveBeenCalled();
  });

  test('workspace-token → 403 (CLI tokens are user-bound; service tokens cannot redeem)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}CALLER`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await POST(postReq(bearer, { code: 'ABCD-EFGH' }));
    expect(res.status).toBe(403);
    expect(fakeRedeem).not.toHaveBeenCalled();
  });

  test('invalid JSON body → 400', async () => {
    await stageUserAuth('user-bearer');
    const r = new Request('https://envstore.xyz/api/v1/link-codes/redeem', {
      method: 'POST',
      headers: { authorization: 'Bearer user-bearer', 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect((await POST(r)).status).toBe(400);
  });

  test('code missing → 400', async () => {
    await stageUserAuth('user-bearer');
    expect((await POST(postReq('user-bearer', {}))).status).toBe(400);
  });

  test('unknown code → 404 with uniform message (no existence leak, no audit)', async () => {
    await stageUserAuth('user-bearer');
    fakeRedeem.mockResolvedValueOnce({ ok: false, reason: 'not-found', message: 'Code not found.' });
    const res = await POST(postReq('user-bearer', { code: 'GHOSTGHO' }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      'Code not found, or you are not a member of its workspace.',
    );
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('valid code but caller is not a workspace member → also 404 with same uniform message', async () => {
    // L4 fix: previously this returned 403 with "You are not a member of this
    // workspace." which distinguished it from a non-existent code. The split
    // gave an oracle for code-existence enumeration. Now both branches return
    // 404 with the same body so the API doesn't confirm the code exists.
    await stageUserAuth('user-bearer');
    fakeRedeem.mockResolvedValueOnce({
      ok: false,
      reason: 'not-a-member',
      message: 'You are not a member of this workspace. Ask the owner to invite you.',
    });
    const res = await POST(postReq('user-bearer', { code: 'ABCDEFGH' }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      'Code not found, or you are not a member of its workspace.',
    );
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('success → 200, returns workspace+project, audit recorded', async () => {
    await stageUserAuth('user-bearer');
    fakeRedeem.mockResolvedValueOnce({
      ok: true,
      workspace: { slug: 'acme' },
      project: { slug: 'api', group: null },
    });
    const res = await POST(postReq('user-bearer', { code: 'ABCDEFGH' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace: 'acme', project: 'api', group: null });

    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; userId: string; metadata: Record<string, unknown> };
    };
    expect(audit.data.action).toBe('invite.accept');
    expect(audit.data.userId).toBe('u_1');
    expect(audit.data.metadata).toMatchObject({ via: 'cli', workspace: 'acme', project: 'api' });
  });
});
