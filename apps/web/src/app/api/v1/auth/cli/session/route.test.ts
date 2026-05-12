// DELETE /api/v1/auth/cli/session — `envstore logout`.
//
// Invariants:
//   - 401 unauthenticated (no DB delete attempted).
//   - Workspace tokens cannot revoke a CLI session.
//   - Authenticated user: delete THIS CLI token, audit, return 204.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  cliToken: { findUnique: mock(), update: mock(), delete: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { DELETE } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.cliToken.delete.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
});

async function stageUserAuth(bearer: string) {
  const tokenHash = await sha256Hex(bearer);
  fakePrisma.cliToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
    if (args.where.tokenHash !== tokenHash) return null;
    return {
      id: 'tok_xyz',
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

function delReq(bearer: string | null): Request {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request('https://envstore.xyz/api/v1/auth/cli/session', {
    method: 'DELETE',
    headers,
  });
}

describe('DELETE /auth/cli/session', () => {
  test('no bearer → 401, no DB delete', async () => {
    const res = await DELETE(delReq(null));
    expect(res.status).toBe(401);
    expect(fakePrisma.cliToken.delete).not.toHaveBeenCalled();
  });

  test('workspace-token → 403 (cannot revoke a user CLI session)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await DELETE(delReq(bearer));
    expect(res.status).toBe(403);
    expect(fakePrisma.cliToken.delete).not.toHaveBeenCalled();
  });

  test('user → 204, deletes THIS cliToken, audit logged', async () => {
    await stageUserAuth('user-bearer');
    const res = await DELETE(delReq('user-bearer'));
    expect(res.status).toBe(204);
    expect(fakePrisma.cliToken.delete).toHaveBeenCalledTimes(1);
    const args = fakePrisma.cliToken.delete.mock.calls[0]?.[0] as { where: { id: string } };
    // The delete must target the caller's OWN token id — not by user, not by hash.
    expect(args.where.id).toBe('tok_xyz');

    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; resourceId: string; userId: string };
    };
    expect(audit.data.action).toBe('cli-token.revoke');
    expect(audit.data.resourceId).toBe('tok_xyz');
    expect(audit.data.userId).toBe('u_1');
  });
});
