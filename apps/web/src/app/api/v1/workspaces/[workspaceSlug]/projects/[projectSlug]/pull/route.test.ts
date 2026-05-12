// Tests for the pull route's authorization gates: token project-scope (F3)
// and the F2 billing gate (`requireWorkspaceRead`). We let the real
// `authenticateBearer` + `tokenAllowsProject` run by staging Prisma's
// cliToken / workspaceToken lookups — the alternative (mocking the auth
// module wholesale) would let a regression in those helpers slip past.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  environment: { findFirst: mock() },
  envFileVersion: { findUnique: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
};

const fakePresignGet = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/r2', () => ({
  presignGet: fakePresignGet,
  R2NotConfiguredError: class extends Error {},
}));

const { GET } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePresignGet.mockReset();
  // The auth path does a fire-and-forget lastUsedAt update — swallow it so
  // every test doesn't have to stage one.
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
});

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme', projectSlug: 'api' }) };

function buildRequest(bearer: string): Request {
  return new Request(
    'https://envstore.xyz/api/v1/workspaces/acme/projects/api/pull?env=development',
    { method: 'GET', headers: { authorization: `Bearer ${bearer}` } },
  );
}

// Stage prisma.cliToken.findUnique to return a CliToken row for the bearer.
async function stageUserAuth(bearer: string): Promise<void> {
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

// Stage prisma.workspaceToken.findUnique for a service token with the given
// project scope. Empty scope = workspace-wide; non-empty = restricted.
async function stageWorkspaceTokenAuth(bearer: string, scopedProjectIds: string[]): Promise<void> {
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
      createdByUserId: 'u_1',
      createdAt: new Date(),
    };
  });
}

function stageWorkspaceResolve(): void {
  fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1', slug: 'acme' });
}

function stageProject(subscription: Record<string, unknown> | null) {
  fakePrisma.project.findFirst.mockResolvedValueOnce({
    id: 'proj_api',
    workspace: { type: 'TEAM', subscription },
  });
}

function stageEnvironmentAndPresign() {
  fakePrisma.environment.findFirst.mockResolvedValueOnce({
    id: 'env_dev',
    slug: 'development',
    currentVersion: {
      id: 'v_1',
      version: 3,
      r2Key: 'k',
      ciphertextSize: 100,
      ciphertextSha256: new Uint8Array(32),
      recipientsHash: new Uint8Array(32),
    },
    project: { workspace: { type: 'TEAM' } },
  });
  fakePresignGet.mockResolvedValueOnce({ url: 'https://r2.signed/v1', expiresIn: 300 });
}

const ACTIVE = { status: 'ACTIVE', canceledAt: null, trialEndsAt: null, paddleSubscriptionId: 'sub_1' };

describe('GET /pull — happy paths', () => {
  test('user auth + active subscription → 200', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceResolve();
    stageProject(ACTIVE);
    stageEnvironmentAndPresign();

    const res = await GET(buildRequest('user-bearer'), ctx);
    expect(res.status).toBe(200);
  });

  test('workspace-wide service token → 200', async () => {
    await stageWorkspaceTokenAuth('eswtok_wide', []);
    stageWorkspaceResolve();
    stageProject(ACTIVE);
    stageEnvironmentAndPresign();

    const res = await GET(buildRequest('eswtok_wide'), ctx);
    expect(res.status).toBe(200);
  });

  test('project-scoped service token covering this project → 200', async () => {
    await stageWorkspaceTokenAuth('eswtok_here', ['proj_api']);
    stageWorkspaceResolve();
    stageProject(ACTIVE);
    stageEnvironmentAndPresign();

    const res = await GET(buildRequest('eswtok_here'), ctx);
    expect(res.status).toBe(200);
  });
});

describe('GET /pull — F2 billing gate', () => {
  test('cancel-grace-expired subscription → 402 (locked)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceResolve();
    stageProject({
      status: 'CANCELED',
      canceledAt: new Date(Date.now() - 365 * 24 * 3600_000),
      trialEndsAt: null,
      paddleSubscriptionId: 'sub_1',
    });

    const res = await GET(buildRequest('user-bearer'), ctx);
    expect(res.status).toBe(402);
    // Locked workspaces must short-circuit before the presign so no
    // download URL ever leaves the API.
    expect(fakePresignGet).not.toHaveBeenCalled();
    expect(fakePrisma.environment.findFirst).not.toHaveBeenCalled();
  });

  test('workspace with no subscription row → 402 (unconfigured = locked)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceResolve();
    stageProject(null);

    const res = await GET(buildRequest('user-bearer'), ctx);
    expect(res.status).toBe(402);
    expect(fakePresignGet).not.toHaveBeenCalled();
  });

  test('trial-expired stays readable (read-only tier, pulls allowed)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspaceResolve();
    stageProject({
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() - 60_000),
      canceledAt: null,
      paddleSubscriptionId: null,
    });
    stageEnvironmentAndPresign();

    const res = await GET(buildRequest('user-bearer'), ctx);
    expect(res.status).toBe(200);
  });
});

describe('GET /pull — F3 token project-scope gate', () => {
  test('project-scoped token NOT covering this project → 403', async () => {
    await stageWorkspaceTokenAuth('eswtok_elsewhere', ['proj_OTHER']);
    stageWorkspaceResolve();
    stageProject(ACTIVE);

    const res = await GET(buildRequest('eswtok_elsewhere'), ctx);
    expect(res.status).toBe(403);
    // 403 on scope short-circuits before billing + presign.
    expect(fakePresignGet).not.toHaveBeenCalled();
    expect(fakePrisma.environment.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /pull — auth', () => {
  test('unknown bearer → 401', async () => {
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(null);
    fakePrisma.workspaceToken.findUnique.mockResolvedValueOnce(null);
    const res = await GET(buildRequest('garbage'), ctx);
    expect(res.status).toBe(401);
    expect(fakePrisma.workspace.findFirst).not.toHaveBeenCalled();
  });

  test('missing Authorization header → 401', async () => {
    const noBearer = new Request(
      'https://envstore.xyz/api/v1/workspaces/acme/projects/api/pull?env=development',
      { method: 'GET' },
    );
    const res = await GET(noBearer, ctx);
    expect(res.status).toBe(401);
  });
});
