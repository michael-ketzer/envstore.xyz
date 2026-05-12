// GET /api/v1/workspaces/[ws]/projects/[proj]/environments
//
// This is a read endpoint. Pinning: auth required, project not found 404,
// project-scoped service tokens for OTHER projects 403 (F3 listing surface).

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  environment: { findMany: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { GET } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakePrisma.environment.findMany.mockResolvedValue([]);
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

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme', projectSlug: 'api' }) };

function getReq(bearer: string | null): Request {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request(
    'https://envstore.xyz/api/v1/workspaces/acme/projects/api/environments',
    { method: 'GET', headers },
  );
}

describe('GET /environments', () => {
  test('no bearer → 401', async () => {
    expect((await GET(getReq(null), ctx)).status).toBe(401);
  });

  test('project not found → 404', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce(null);
    const res = await GET(getReq('user-bearer'), ctx);
    expect(res.status).toBe(404);
    expect(fakePrisma.environment.findMany).not.toHaveBeenCalled();
  });

  test('F3: project-scoped token NOT covering this project → 403, never lists envs', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}ELSE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_OTHER']);
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const res = await GET(getReq(bearer), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.environment.findMany).not.toHaveBeenCalled();
  });

  test('user → 200, returns envs with currentVersion serialized and versionsCount', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const createdAt = new Date('2026-03-01T00:00:00Z');
    fakePrisma.environment.findMany.mockResolvedValueOnce([
      {
        slug: 'production',
        name: 'Production',
        currentVersion: { version: 7, createdAt, ciphertextSize: 1024 },
        _count: { versions: 12 },
      },
      {
        slug: 'staging',
        name: 'Staging',
        currentVersion: null,
        _count: { versions: 0 },
      },
    ]);
    const res = await GET(getReq('user-bearer'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]).toEqual({
      slug: 'production',
      name: 'Production',
      currentVersion: { version: 7, createdAt: createdAt.toISOString(), ciphertextSize: 1024 },
      versionsCount: 12,
    });
    expect(body[1]!.currentVersion).toBeNull();
    expect(body[1]!.versionsCount).toBe(0);
  });

  test('project-scoped token for THIS project → 200', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}HERE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_api']);
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const res = await GET(getReq(bearer), ctx);
    expect(res.status).toBe(200);
  });
});
