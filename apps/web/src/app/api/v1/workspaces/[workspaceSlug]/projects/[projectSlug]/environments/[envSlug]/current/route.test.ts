// POST /api/v1/workspaces/[ws]/projects/[proj]/environments/[env]/current
//
// Pinning: auth required, project-scope gate, billing-WRITE gate (rollback
// changes effective state), body validation (either versionId or
// version, not both, not neither), no-op short-circuit when already
// current, atomic pointer flip, audit logged with previous + new.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

// The route does a compare-and-swap inside one prisma.$transaction:
//   tx.environment.findUnique   (re-read under tx for the actual previousVersionId)
//   tx.environment.updateMany   (CAS flip — count=0 means another writer raced past)
//   tx.auditLog.create          (only fires when CAS won)
const fakeTx = {
  environment: { findUnique: mock(), updateMany: mock() },
  auditLog: { create: mock() },
};
const fakeTransaction = mock(async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx));

const fakePrisma = {
  $transaction: fakeTransaction,
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  environment: { findFirst: mock() },
  envFileVersion: { findFirst: mock(), findUnique: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { POST } = await import('./route');

// Reset every mock function reachable from fakePrisma and fakeTx.
function resetMocks(obj: Record<string, unknown>): void {
  for (const v of Object.values(obj)) {
    if (typeof v === 'function' && 'mockReset' in v) {
      (v as ReturnType<typeof mock>).mockReset();
    } else if (v && typeof v === 'object') {
      resetMocks(v as Record<string, unknown>);
    }
  }
}

beforeEach(() => {
  resetMocks(fakePrisma);
  resetMocks(fakeTx);
  // resetMocks above clears $transaction's implementation too, so re-
  // install the pass-through default that calls the callback with the
  // mock tx.
  fakeTransaction.mockImplementation(async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx));
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakeTx.auditLog.create.mockResolvedValue({});
  // CAS happy default: the in-tx re-read sees the same currentVersionId
  // the outer-tx read did, and the updateMany succeeds (count=1). Each
  // test that wants to simulate a race overrides these per-call.
  fakeTx.environment.updateMany.mockResolvedValue({ count: 1 });
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

async function stageWorkspaceTokenAuth(bearer: string, scopedProjectIds: string[]) {
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
      scopedProjectIds,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdByUserId: 'u_admin',
      createdAt: new Date(),
    };
  });
}

const ctx = (envSlug = 'production') => ({
  params: Promise.resolve({ workspaceSlug: 'acme', projectSlug: 'api', envSlug }),
});

function postReq(bearer: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request(
    'https://envstore.xyz/api/v1/workspaces/acme/projects/api/environments/production/current',
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
}

function stageHappyProject() {
  fakePrisma.project.findFirst.mockResolvedValueOnce({
    id: 'proj_api',
    workspaceId: 'ws_1',
    workspace: {
      type: 'TEAM',
      subscription: {
        status: 'ACTIVE',
        trialEndsAt: null,
        canceledAt: null,
        paddleSubscriptionId: 'sub_1',
      },
    },
  });
}

describe('POST /current — auth + body validation', () => {
  test('no bearer → 401', async () => {
    expect((await POST(postReq(null, { version: 1 }), ctx())).status).toBe(401);
  });

  test('invalid JSON body → 400', async () => {
    await stageUserAuth('user-bearer');
    const req = new Request(
      'https://envstore.xyz/api/v1/workspaces/acme/projects/api/environments/production/current',
      {
        method: 'POST',
        headers: { authorization: 'Bearer user-bearer', 'content-type': 'application/json' },
        body: '{not-json',
      },
    );
    expect((await POST(req, ctx())).status).toBe(400);
  });

  test('neither versionId nor version → 400', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(postReq('user-bearer', {}), ctx());
    expect(res.status).toBe(400);
  });

  test('both versionId AND version → 400 (refuse ambiguous)', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(
      postReq('user-bearer', { versionId: 'ver_1', version: 1 }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  test('invalid env slug → 400, no project lookup', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(postReq('user-bearer', { version: 1 }), ctx('Has Spaces'));
    expect(res.status).toBe(400);
    expect(fakePrisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /current — scope + billing', () => {
  test('F3: project-scoped token NOT covering this project → 403', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}ELSE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_OTHER']);
    stageHappyProject();
    const res = await POST(postReq(bearer, { version: 1 }), ctx());
    expect(res.status).toBe(403);
    expect(fakeTx.environment.updateMany).not.toHaveBeenCalled();
  });

  test('billing read-only tier (trial expired) → 402, no update', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce({
      id: 'proj_api',
      workspaceId: 'ws_1',
      workspace: {
        type: 'TEAM',
        subscription: {
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          canceledAt: null,
          paddleSubscriptionId: null,
        },
      },
    });
    const res = await POST(postReq('user-bearer', { version: 1 }), ctx());
    expect(res.status).toBe(402);
    expect(fakeTx.environment.updateMany).not.toHaveBeenCalled();
  });

  test('environment not found → 404', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce(null);
    const res = await POST(postReq('user-bearer', { version: 1 }), ctx());
    expect(res.status).toBe(404);
  });

  test('version not found in this env → 404', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce(null);
    const res = await POST(postReq('user-bearer', { version: 99 }), ctx());
    expect(res.status).toBe(404);
    expect(fakeTx.environment.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /current — happy path + no-op', () => {
  test('rolling back to a real older version → 200, CAS flip + audit with fresh previousVersionId', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ id: 'ver_5', version: 5 });
    // In-tx re-read returns the same currentVersionId as the outer-tx
    // read — no concurrent rollback landed between them. updateMany
    // succeeds with count=1 (from the beforeEach default).
    fakeTx.environment.findUnique.mockResolvedValueOnce({
      currentVersionId: 'ver_8',
      slug: 'production',
    });

    const res = await POST(postReq('user-bearer', { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; noop: boolean; version: number };
    expect(body).toMatchObject({ ok: true, noop: false, version: 5 });

    // CAS shape: where includes BOTH id AND the current pointer value
    // we read; data flips to the target.
    expect(fakeTx.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'env_prod', currentVersionId: 'ver_8' },
      data: { currentVersionId: 'ver_5' },
    });
    const auditCall = fakeTx.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; metadata: Record<string, unknown> };
    };
    expect(auditCall.data.action).toBe('environment.update');
    expect(auditCall.data.metadata).toMatchObject({
      env: 'production',
      rolledBackTo: 5,
      previousVersionId: 'ver_8',
    });
  });

  test('outer-tx fast-path no-op (already current per outer read) → 200, no transaction work', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_5',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ id: 'ver_5', version: 5 });

    const res = await POST(postReq('user-bearer', { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { noop: boolean };
    expect(body.noop).toBe(true);
    // The outer fast path short-circuits before we even open the tx.
    expect(fakeTransaction).not.toHaveBeenCalled();
    expect(fakeTx.environment.updateMany).not.toHaveBeenCalled();
    expect(fakeTx.auditLog.create).not.toHaveBeenCalled();
  });

  test('in-tx no-op: another rollback raced and now matches our target → noop:true, no audit', async () => {
    // Outer read sees ver_8; we open the tx; the in-tx re-read sees
    // ver_5 (because a concurrent rollback to ver_5 won). Our target
    // is ver_5, so the CAS path bails: no updateMany, no audit.
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ id: 'ver_5', version: 5 });
    fakeTx.environment.findUnique.mockResolvedValueOnce({
      currentVersionId: 'ver_5',
      slug: 'production',
    });

    const res = await POST(postReq('user-bearer', { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { noop: boolean };
    expect(body.noop).toBe(true);
    expect(fakeTx.environment.updateMany).not.toHaveBeenCalled();
    expect(fakeTx.auditLog.create).not.toHaveBeenCalled();
  });

  test('in-tx CAS conflict: race flipped pointer to a third value → updateMany.count=0, noop:true, no audit', async () => {
    // Outer read sees ver_8; in-tx re-read STILL sees ver_8 (the
    // racing writer hasn't committed yet); we issue the conditional
    // updateMany but by the time it runs the race has won and the
    // pointer is ver_9 — count comes back 0.
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ id: 'ver_5', version: 5 });
    fakeTx.environment.findUnique.mockResolvedValueOnce({
      currentVersionId: 'ver_8',
      slug: 'production',
    });
    fakeTx.environment.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(postReq('user-bearer', { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { noop: boolean };
    expect(body.noop).toBe(true);
    expect(fakeTx.auditLog.create).not.toHaveBeenCalled();
  });

  test('using versionId path → 200, finds by id scoped to env', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findFirst.mockResolvedValueOnce({ id: 'ver_5', version: 5 });
    fakeTx.environment.findUnique.mockResolvedValueOnce({
      currentVersionId: 'ver_8',
      slug: 'production',
    });

    const res = await POST(postReq('user-bearer', { versionId: 'ver_5' }), ctx());
    expect(res.status).toBe(200);
    expect(fakePrisma.envFileVersion.findFirst).toHaveBeenCalledWith({
      where: { id: 'ver_5', environmentId: 'env_prod' },
      select: { id: true, version: true },
    });
  });

  test('workspace token (project-scoped to this proj) → 200, audit attributes to workspaceTokenId', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}HERE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_api']);
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ id: 'ver_5', version: 5 });
    fakeTx.environment.findUnique.mockResolvedValueOnce({
      currentVersionId: 'ver_8',
      slug: 'production',
    });

    const res = await POST(postReq(bearer, { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const auditCall = fakeTx.auditLog.create.mock.calls[0]?.[0] as {
      data: { userId: string | null; workspaceTokenId: string | null; metadata: Record<string, unknown> };
    };
    expect(auditCall.data.userId).toBeNull();
    expect(auditCall.data.workspaceTokenId).toBe('wstok_1');
    expect(auditCall.data.metadata).toMatchObject({ via: 'workspace-token' });
  });
});
