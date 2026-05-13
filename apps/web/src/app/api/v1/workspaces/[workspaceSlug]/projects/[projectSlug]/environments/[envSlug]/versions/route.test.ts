// GET /api/v1/workspaces/[ws]/projects/[proj]/environments/[env]/versions
//
// Pinning: auth required, project-scope gate, billing-read gate, envSlug
// validation, list shape (current marker, cap surfaced), cursor pagination.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  environment: { findFirst: mock() },
  envFileVersion: { findFirst: mock(), findMany: mock() },
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

function getReq(bearer: string | null, qs = ''): Request {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request(
    `https://envstore.xyz/api/v1/workspaces/acme/projects/api/environments/production/versions${qs}`,
    { method: 'GET', headers },
  );
}

// Standard "happy" project stub — billing ACTIVE, no token scope filter.
function stageHappyProject() {
  fakePrisma.project.findFirst.mockResolvedValueOnce({
    id: 'proj_api',
    workspace: {
      versionHistoryLimit: 50,
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

describe('GET /versions — auth + project gates', () => {
  test('no bearer → 401', async () => {
    expect((await GET(getReq(null), ctx())).status).toBe(401);
  });

  test('project not found → 404', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce(null);
    const res = await GET(getReq('user-bearer'), ctx());
    expect(res.status).toBe(404);
    expect(fakePrisma.environment.findFirst).not.toHaveBeenCalled();
  });

  test('F3: project-scoped token NOT covering this project → 403', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}ELSE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_OTHER']);
    stageHappyProject();
    const res = await GET(getReq(bearer), ctx());
    expect(res.status).toBe(403);
    expect(fakePrisma.environment.findFirst).not.toHaveBeenCalled();
  });

  test('environment not found → 404', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce(null);
    const res = await GET(getReq('user-bearer'), ctx());
    expect(res.status).toBe(404);
  });
});

describe('GET /versions — envSlug validation', () => {
  test('invalid slug shape → 400', async () => {
    await stageUserAuth('user-bearer');
    const res = await GET(getReq('user-bearer'), ctx('Has Spaces!'));
    expect(res.status).toBe(400);
    expect(fakePrisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /versions — billing read gate', () => {
  test('locked workspace (cancel past grace) → 402', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce({
      id: 'proj_api',
      workspace: {
        versionHistoryLimit: 50,
        type: 'TEAM',
        subscription: {
          status: 'CANCELED',
          trialEndsAt: null,
          // Way past the 30-day grace.
          canceledAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          paddleSubscriptionId: 'sub_1',
        },
      },
    });
    const res = await GET(getReq('user-bearer'), ctx());
    expect(res.status).toBe(402);
    expect(fakePrisma.environment.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /versions — happy path', () => {
  test('user → 200, returns versions with current marker + cap', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: 'ver_7',
    });
    const createdAt = new Date('2026-03-01T00:00:00Z');
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([
      {
        id: 'ver_8',
        version: 8,
        ciphertextSize: 256,
        comment: 'fix PAYMENT_KEY',
        createdAt,
        createdBy: { email: 'alice@example.com' },
      },
      {
        id: 'ver_7',
        version: 7,
        ciphertextSize: 200,
        comment: null,
        createdAt,
        createdBy: { email: 'bob@example.com' },
      },
    ]);
    const res = await GET(getReq('user-bearer'), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      environmentSlug: string;
      versions: Array<{ version: number; current: boolean; createdByEmail: string }>;
      versionHistoryLimit: number;
    };
    expect(body.environmentSlug).toBe('production');
    expect(body.versionHistoryLimit).toBe(50);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0]).toMatchObject({ version: 8, current: false });
    expect(body.versions[1]).toMatchObject({ version: 7, current: true });
  });

  test('passing project-scoped token covering THIS project → 200', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}OK`;
    await stageWorkspaceTokenAuth(bearer, ['proj_api']);
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: null,
    });
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([]);
    const res = await GET(getReq(bearer), ctx());
    expect(res.status).toBe(200);
  });
});

describe('GET /versions — pagination cursor', () => {
  test('invalid cursor → 400', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: null,
    });
    fakePrisma.envFileVersion.findFirst.mockResolvedValueOnce(null);
    const res = await GET(getReq('user-bearer', '?cursor=nope'), ctx());
    expect(res.status).toBe(400);
  });

  test('valid cursor → findMany filters with version: { lt: cursorVersion }', async () => {
    await stageUserAuth('user-bearer');
    stageHappyProject();
    fakePrisma.environment.findFirst.mockResolvedValueOnce({
      id: 'env_prod',
      slug: 'production',
      currentVersionId: null,
    });
    fakePrisma.envFileVersion.findFirst.mockResolvedValueOnce({ version: 12 });
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([]);
    const res = await GET(getReq('user-bearer', '?cursor=ver_12&limit=10'), ctx());
    expect(res.status).toBe(200);
    const where = fakePrisma.envFileVersion.findMany.mock.calls[0]?.[0]?.where as {
      version: { lt: number };
    };
    expect(where.version).toEqual({ lt: 12 });
  });
});
