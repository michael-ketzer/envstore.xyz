// GET /api/v1/me — the CLI's "what does this token unlock?" probe.
//
// Returns the caller's user record, their workspace memberships (excluding
// soft-deleted workspaces), and their registered recipients. User-only —
// service tokens can't introspect through this surface.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspaceMember: { findMany: mock() },
  userRecipient: { findMany: mock() },
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
  fakePrisma.workspaceMember.findMany.mockResolvedValue([]);
  fakePrisma.userRecipient.findMany.mockResolvedValue([]);
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
        name: 'Alice',
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

function req(bearer: string | null): Request {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request('https://envstore.xyz/api/v1/me', { method: 'GET', headers });
}

describe('GET /me', () => {
  test('no bearer → 401', async () => {
    expect((await GET(req(null))).status).toBe(401);
    expect(fakePrisma.workspaceMember.findMany).not.toHaveBeenCalled();
  });

  test('workspace-token → 403 (introspection is user-only)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await GET(req(bearer));
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceMember.findMany).not.toHaveBeenCalled();
  });

  test('user → 200, returns user + workspaces + recipients', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.workspaceMember.findMany.mockResolvedValueOnce([
      {
        role: 'OWNER',
        workspace: { slug: 'me', name: 'Personal', type: 'PERSONAL' },
      },
      {
        role: 'ADMIN',
        workspace: { slug: 'acme', name: 'Acme', type: 'TEAM' },
      },
    ]);
    fakePrisma.userRecipient.findMany.mockResolvedValueOnce([
      { id: 'rec_1', recipient: 'age1stub', kind: 'AGE_X25519', label: 'laptop' },
    ]);

    const res = await GET(req('user-bearer'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.user).toEqual({ id: 'u_1', email: 'alice@example.com', name: 'Alice' });
    expect(body.workspaces).toEqual([
      { slug: 'me', name: 'Personal', type: 'PERSONAL', role: 'OWNER' },
      { slug: 'acme', name: 'Acme', type: 'TEAM', role: 'ADMIN' },
    ]);
    expect(body.recipients).toEqual([
      { id: 'rec_1', recipient: 'age1stub', kind: 'AGE_X25519', label: 'laptop' },
    ]);
  });

  test('workspace list excludes soft-deleted workspaces (filter is on the query)', async () => {
    await stageUserAuth('user-bearer');
    await GET(req('user-bearer'));
    const args = fakePrisma.workspaceMember.findMany.mock.calls[0]?.[0] as {
      where: { userId: string; workspace: { deletedAt: null } };
    };
    expect(args.where.userId).toBe('u_1');
    expect(args.where.workspace.deletedAt).toBeNull();
  });
});
