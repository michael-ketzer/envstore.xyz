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

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  environment: { findFirst: mock(), update: mock() },
  envFileVersion: { findFirst: mock(), findUnique: mock() },
  auditLog: { create: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakePrisma.environment.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
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
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
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
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
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
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
  });
});

describe('POST /current — happy path + no-op', () => {
  test('rolling back to a real older version → 200, pointer flipped, audit logged', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_8',
    });
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ id: 'ver_5', version: 5 });

    const res = await POST(postReq('user-bearer', { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; noop: boolean; version: number };
    expect(body).toMatchObject({ ok: true, noop: false, version: 5 });

    expect(fakePrisma.environment.update).toHaveBeenCalledWith({
      where: { id: 'env_prod' },
      data: { currentVersionId: 'ver_5' },
    });
    const auditCall = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; metadata: Record<string, unknown> };
    };
    expect(auditCall.data.action).toBe('environment.update');
    expect(auditCall.data.metadata).toMatchObject({
      env: 'production',
      rolledBackTo: 5,
      previousVersionId: 'ver_8',
    });
  });

  test('target version is ALREADY current → 200 noop, no update, no audit', async () => {
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
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
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

    const res = await POST(postReq(bearer, { version: 5 }), ctx());
    expect(res.status).toBe(200);
    const auditCall = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { userId: string | null; workspaceTokenId: string | null; metadata: Record<string, unknown> };
    };
    expect(auditCall.data.userId).toBeNull();
    expect(auditCall.data.workspaceTokenId).toBe('wstok_1');
    expect(auditCall.data.metadata).toMatchObject({ via: 'workspace-token' });
  });
});
