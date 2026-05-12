// F3 regression: project-scoped service tokens should not be able to browse
// workspace-level group metadata (slugs, names, descriptions). The GET
// handler 403s for project-scoped tokens; workspace-wide tokens and user
// auth pass through.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  projectGroup: { findMany: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
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
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakePrisma.projectGroup.findMany.mockResolvedValue([]);
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

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme' }) };

function req(bearer: string): Request {
  return new Request('https://envstore.xyz/api/v1/workspaces/acme/groups', {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer}` },
  });
}

describe('GET /groups — F3 project-scope gate', () => {
  test('user auth → 200', async () => {
    await stageUserAuth('user-bearer');
    const res = await GET(req('user-bearer'), ctx);
    expect(res.status).toBe(200);
  });

  test('workspace-wide service token → 200', async () => {
    await stageWorkspaceToken('eswtok_wide', []);
    const res = await GET(req('eswtok_wide'), ctx);
    expect(res.status).toBe(200);
  });

  test('F3: project-scoped service token → 403 (groups are workspace metadata, off-limits to scoped tokens)', async () => {
    await stageWorkspaceToken('eswtok_scoped', ['proj_api']);
    const res = await GET(req('eswtok_scoped'), ctx);
    expect(res.status).toBe(403);
    // The refusal must happen BEFORE the group list query — otherwise
    // slugs/names/descriptions would leak even with a 403 body.
    expect(fakePrisma.projectGroup.findMany).not.toHaveBeenCalled();
  });

  test('unknown bearer → 401', async () => {
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(null);
    fakePrisma.workspaceToken.findUnique.mockResolvedValueOnce(null);
    const res = await GET(req('garbage'), ctx);
    expect(res.status).toBe(401);
  });
});
