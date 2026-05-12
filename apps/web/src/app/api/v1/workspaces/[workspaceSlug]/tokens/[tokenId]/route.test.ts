// Tests for DELETE /api/v1/workspaces/[ws]/tokens/[tokenId].
//
// Revocation has the same admin-only + no-service-token-can-mint property
// as creation. Idempotency: revoking an already-revoked token returns ok
// without re-stamping revokedAt.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  workspaceMember: { findUnique: mock() },
  workspaceToken: {
    findUnique: mock(),
    findFirst: mock(),
    update: mock(),
  },
  cliToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { DELETE } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakePrisma.workspaceToken.findUnique.mockResolvedValue(null);
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

async function stageWorkspaceTokenAuth(bearer: string) {
  const tokenHash = await sha256Hex(bearer);
  fakePrisma.workspaceToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
    if (args.where.tokenHash !== tokenHash) return null;
    return {
      id: 'wstok_caller',
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

function stageMembership(role: 'OWNER' | 'ADMIN' | 'MEMBER' | null) {
  if (role === null) fakePrisma.workspaceMember.findUnique.mockResolvedValue(null);
  else fakePrisma.workspaceMember.findUnique.mockResolvedValue({ role });
}

const ctx = (tokenId: string) => ({
  params: Promise.resolve({ workspaceSlug: 'acme', tokenId }),
});

function delReq(bearer: string, tokenId: string): Request {
  return new Request(
    `https://envstore.xyz/api/v1/workspaces/acme/tokens/${tokenId}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${bearer}` } },
  );
}

describe('DELETE /tokens/:id', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/workspaces/acme/tokens/wstok_1', {
      method: 'DELETE',
    });
    const res = await DELETE(r, ctx('wstok_1'));
    expect(res.status).toBe(401);
  });

  test('service token → 403 (cannot revoke other tokens)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}CALLER`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await DELETE(delReq(bearer, 'wstok_target'), ctx('wstok_target'));
    expect(res.status).toBe(403);
    // The auth path itself stamps `lastUsedAt`, so workspaceToken.update is
    // expected to fire once for that. What MUST NOT happen is a revoke —
    // the lookup that precedes a revoke (findFirst) should be skipped.
    expect(fakePrisma.workspaceToken.findFirst).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('member (non-admin) → 403', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('MEMBER');
    const res = await DELETE(delReq('user-bearer', 'wstok_target'), ctx('wstok_target'));
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceToken.findFirst).not.toHaveBeenCalled();
  });

  test('admin revokes active token → 200, audit logged', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakePrisma.workspaceToken.findFirst.mockResolvedValueOnce({
      id: 'wstok_target',
      revokedAt: null,
    });
    const res = await DELETE(delReq('user-bearer', 'wstok_target'), ctx('wstok_target'));
    expect(res.status).toBe(200);
    expect(fakePrisma.workspaceToken.update).toHaveBeenCalledTimes(1);
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; resourceId: string };
    };
    expect(audit.data.action).toBe('workspaceToken.revoke');
    expect(audit.data.resourceId).toBe('wstok_target');
  });

  test('idempotent: revoking already-revoked token → 200, NO update', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakePrisma.workspaceToken.findFirst.mockResolvedValueOnce({
      id: 'wstok_target',
      revokedAt: new Date('2026-01-01'),
    });
    const res = await DELETE(delReq('user-bearer', 'wstok_target'), ctx('wstok_target'));
    expect(res.status).toBe(200);
    expect(fakePrisma.workspaceToken.update).not.toHaveBeenCalled();
    // Audit STILL fires — the user requested a revoke, even if no-op.
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  test('unknown tokenId or token in different workspace → 404', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakePrisma.workspaceToken.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(delReq('user-bearer', 'wstok_ghost'), ctx('wstok_ghost'));
    expect(res.status).toBe(404);
    expect(fakePrisma.workspaceToken.update).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
