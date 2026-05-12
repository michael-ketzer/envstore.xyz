// Tests for DELETE /api/v1/me/recipients/[id].
//
// Two things matter: (1) the lookup is scoped by userId, so a caller can't
// probe another user's recipient IDs via 200/404 timing; (2) a workspace
// token can never reach the delete path.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  userRecipient: { findFirst: mock(), delete: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
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
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakePrisma.userRecipient.delete.mockResolvedValue({});
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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(bearer: string, id: string): Request {
  return new Request(`https://envstore.xyz/api/v1/me/recipients/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${bearer}` },
  });
}

describe('DELETE /me/recipients/:id', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/me/recipients/rec_1', {
      method: 'DELETE',
    });
    const res = await DELETE(r, ctx('rec_1'));
    expect(res.status).toBe(401);
  });

  test('workspace-token → 403, no delete', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await DELETE(req(bearer, 'rec_1'), ctx('rec_1'));
    expect(res.status).toBe(403);
    expect(fakePrisma.userRecipient.findFirst).not.toHaveBeenCalled();
    expect(fakePrisma.userRecipient.delete).not.toHaveBeenCalled();
  });

  test('user delete → lookup is scoped by userId (no cross-user probing)', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.findFirst.mockResolvedValueOnce({
      id: 'rec_1',
      recipient: 'age1stub',
      kind: 'AGE_X25519',
      label: 'laptop',
    });

    const res = await DELETE(req('user-bearer', 'rec_1'), ctx('rec_1'));
    expect(res.status).toBe(200);
    const lookup = fakePrisma.userRecipient.findFirst.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    expect(lookup.where.id).toBe('rec_1');
    // Critical: the userId scope means a caller can't delete (or even
    // detect) recipients that belong to someone else.
    expect(lookup.where.userId).toBe('u_1');
    expect(fakePrisma.userRecipient.delete).toHaveBeenCalledTimes(1);
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  test("another user's recipient → 404 (does not leak existence)", async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(req('user-bearer', 'rec_someone_else'), ctx('rec_someone_else'));
    expect(res.status).toBe(404);
    expect(fakePrisma.userRecipient.delete).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
