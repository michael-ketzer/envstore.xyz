// Tests for POST /push/[versionId]/finalize.
//
// Critical invariant: Environment.currentVersionId must NOT flip unless R2
// reports the object at the announced size. Otherwise a partial / lying
// upload could become the canonical version and break every pull until the
// next successful push.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';
import { FakeR2NotConfigured, makeR2Mock } from '@/test/r2-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  envFileVersion: { findFirst: mock() },
  environment: { update: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

const fakeHeadObject = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/r2', () => makeR2Mock({ headObject: fakeHeadObject }));

const { POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeHeadObject.mockReset();
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
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

function stageWorkspaceAndProject() {
  fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1', slug: 'acme' });
  fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
}

function stageVersion(opts: { ciphertextSize: number; r2Key?: string } = { ciphertextSize: 100 }) {
  fakePrisma.envFileVersion.findFirst.mockResolvedValueOnce({
    id: 'ver_1',
    version: 1,
    r2Key: opts.r2Key ?? 'k/v1',
    ciphertextSize: opts.ciphertextSize,
    environment: {
      id: 'env_dev',
      slug: 'development',
      project: { workspaceId: 'ws_1' },
    },
  });
}

const ctx = {
  params: Promise.resolve({ workspaceSlug: 'acme', projectSlug: 'api', versionId: 'ver_1' }),
};

function buildReq(bearer: string): Request {
  return new Request(
    'https://envstore.xyz/api/v1/workspaces/acme/projects/api/push/ver_1/finalize',
    { method: 'POST', headers: { authorization: `Bearer ${bearer}` } },
  );
}

describe('POST /finalize — happy path', () => {
  test('R2 reports matching size → flip currentVersionId, 200', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceAndProject();
    stageVersion({ ciphertextSize: 100 });
    fakeHeadObject.mockResolvedValueOnce({ contentLength: 100 });

    const res = await POST(buildReq('user-bearer'), ctx);
    expect(res.status).toBe(200);
    expect(fakePrisma.environment.update).toHaveBeenCalledTimes(1);
    const args = fakePrisma.environment.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { currentVersionId: string };
    };
    expect(args.where.id).toBe('env_dev');
    expect(args.data.currentVersionId).toBe('ver_1');
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /finalize — R2 verification gate', () => {
  test('R2 reports no object (HEAD returns null) → 410, currentVersionId NOT flipped', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceAndProject();
    stageVersion({ ciphertextSize: 100 });
    fakeHeadObject.mockResolvedValueOnce(null);

    const res = await POST(buildReq('user-bearer'), ctx);
    expect(res.status).toBe(410);
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('R2 size mismatch → 409, currentVersionId NOT flipped', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceAndProject();
    stageVersion({ ciphertextSize: 100 });
    // Caller said 100 bytes; R2 has 99 (truncated upload).
    fakeHeadObject.mockResolvedValueOnce({ contentLength: 99 });

    const res = await POST(buildReq('user-bearer'), ctx);
    expect(res.status).toBe(409);
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('R2 not configured → 503 (not 500)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceAndProject();
    stageVersion({ ciphertextSize: 100 });
    fakeHeadObject.mockRejectedValueOnce(new FakeR2NotConfigured());

    const res = await POST(buildReq('user-bearer'), ctx);
    expect(res.status).toBe(503);
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
  });
});

describe('POST /finalize — auth + scope gates', () => {
  test('no bearer → 401', async () => {
    const r = new Request(
      'https://envstore.xyz/api/v1/workspaces/acme/projects/api/push/ver_1/finalize',
      { method: 'POST' },
    );
    const res = await POST(r, ctx);
    expect(res.status).toBe(401);
    expect(fakeHeadObject).not.toHaveBeenCalled();
  });

  test('F3: project-scoped token NOT covering this project → 403, no HEAD, no flip', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}ELSE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_OTHER']);
    stageWorkspaceAndProject();
    const res = await POST(buildReq(bearer), ctx);
    expect(res.status).toBe(403);
    expect(fakeHeadObject).not.toHaveBeenCalled();
    expect(fakePrisma.environment.update).not.toHaveBeenCalled();
  });

  test('version not found (or belongs to different project) → 404', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceAndProject();
    fakePrisma.envFileVersion.findFirst.mockResolvedValueOnce(null);
    const res = await POST(buildReq('user-bearer'), ctx);
    expect(res.status).toBe(404);
    expect(fakeHeadObject).not.toHaveBeenCalled();
  });
});
