// F3 regression: project-scoped service tokens used to be able to enumerate
// recipient metadata for projects outside their allowlist by hitting
// `/recipients?project=other`. The fix added `tokenAllowsProject` to that
// path and a workspace-wide-call refusal for project-scoped tokens.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock(), findUnique: mock() },
  project: { findFirst: mock() },
  workspaceMember: { findMany: mock() },
  workspaceToken: { findUnique: mock(), findMany: mock(), update: mock() },
  cliToken: { findUnique: mock(), update: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { GET } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  // Resolve workspace once for every test that gets that far.
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakePrisma.workspace.findUnique.mockResolvedValue({ id: 'ws_1', slug: 'acme', type: 'TEAM' });
  // Empty member + token lists by default — happy-path tests can stay terse.
  fakePrisma.workspaceMember.findMany.mockResolvedValue([]);
  fakePrisma.workspaceToken.findMany.mockResolvedValue([]);
});

async function stageWorkspaceToken(bearer: string, scopedProjectIds: string[]) {
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

function req(bearer: string, project?: string): Request {
  const url = project
    ? `https://envstore.xyz/api/v1/workspaces/acme/recipients?project=${project}`
    : `https://envstore.xyz/api/v1/workspaces/acme/recipients`;
  return new Request(url, { method: 'GET', headers: { authorization: `Bearer ${bearer}` } });
}

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme' }) };

describe('GET /recipients — F3 project-scope gates', () => {
  test('user auth, no project arg → 200 (no scope restriction)', async () => {
    await stageUserAuth('user-bearer');
    const res = await GET(req('user-bearer'), ctx);
    expect(res.status).toBe(200);
  });

  test('user auth + ?project=existing → 200', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const res = await GET(req('user-bearer', 'api'), ctx);
    expect(res.status).toBe(200);
  });

  test('workspace-wide service token + ?project=existing → 200', async () => {
    await stageWorkspaceToken('eswtok_wide', []);
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const res = await GET(req('eswtok_wide', 'api'), ctx);
    expect(res.status).toBe(200);
  });

  test('project-scoped token + ?project that IS in its allowlist → 200', async () => {
    await stageWorkspaceToken('eswtok_here', ['proj_api']);
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const res = await GET(req('eswtok_here', 'api'), ctx);
    expect(res.status).toBe(200);
  });

  test('F3: project-scoped token + ?project that is NOT in its allowlist → 403', async () => {
    await stageWorkspaceToken('eswtok_elsewhere', ['proj_OTHER']);
    fakePrisma.project.findFirst.mockResolvedValueOnce({ id: 'proj_api' });
    const res = await GET(req('eswtok_elsewhere', 'api'), ctx);
    expect(res.status).toBe(403);
    // The refusal must happen BEFORE recipient enumeration — otherwise
    // labels/emails for the out-of-scope project would still flow back.
    expect(fakePrisma.workspaceMember.findMany).not.toHaveBeenCalled();
  });

  test('F3: project-scoped token with NO ?project → 403 (refuse rather than leak workspace-wide member recipients)', async () => {
    await stageWorkspaceToken('eswtok_scoped_nothing', ['proj_api']);
    const res = await GET(req('eswtok_scoped_nothing'), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceMember.findMany).not.toHaveBeenCalled();
  });

  test('workspace-wide service token with NO ?project → 200 (workspace-wide tokens may enumerate)', async () => {
    await stageWorkspaceToken('eswtok_wide_nothing', []);
    const res = await GET(req('eswtok_wide_nothing'), ctx);
    expect(res.status).toBe(200);
  });

  test('?project=missing → 404 regardless of scope', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.project.findFirst.mockResolvedValueOnce(null);
    const res = await GET(req('user-bearer', 'ghost'), ctx);
    expect(res.status).toBe(404);
  });
});
