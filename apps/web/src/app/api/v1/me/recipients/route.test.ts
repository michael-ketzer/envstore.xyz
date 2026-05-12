// Tests for /api/v1/me/recipients (list + register).
//
// Recipients decide who can decrypt every FUTURE push. The invariants:
//   - User-auth only (workspace tokens cannot mutate recipient sets).
//   - Server validates the recipient structurally (no junk in DB).
//   - Per-user cap enforced.
//   - Duplicate add is idempotent (label updates apply; no row dup).

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { LIMITS, WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  userRecipient: {
    findMany: mock(),
    findUnique: mock(),
    count: mock(),
    create: mock(),
    update: mock(),
  },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const VALID_AGE =
  'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

const { GET, POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakePrisma.userRecipient.findMany.mockResolvedValue([]);
  fakePrisma.userRecipient.findUnique.mockResolvedValue(null);
  fakePrisma.userRecipient.count.mockResolvedValue(0);
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

function postReq(bearer: string, body: unknown): Request {
  return new Request('https://envstore.xyz/api/v1/me/recipients', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(bearer: string): Request {
  return new Request('https://envstore.xyz/api/v1/me/recipients', {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer}` },
  });
}

describe('GET /me/recipients', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/me/recipients', { method: 'GET' });
    const res = await GET(r);
    expect(res.status).toBe(401);
  });

  test('workspace-token → 403 (this is a user-only endpoint)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOKEN`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await GET(getReq(bearer));
    expect(res.status).toBe(403);
    expect(fakePrisma.userRecipient.findMany).not.toHaveBeenCalled();
  });

  test('user auth → 200, scoped to caller', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.findMany.mockResolvedValueOnce([
      {
        id: 'rec_1',
        recipient: VALID_AGE,
        kind: 'AGE_X25519',
        label: 'laptop',
        createdAt: new Date(),
        lastUsedAt: null,
      },
    ]);
    const res = await GET(getReq('user-bearer'));
    expect(res.status).toBe(200);
    const findArgs = fakePrisma.userRecipient.findMany.mock.calls[0]?.[0] as {
      where: { userId: string };
    };
    expect(findArgs.where.userId).toBe('u_1');
  });
});

describe('POST /me/recipients — auth + validation', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/me/recipients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
  });

  test('workspace-token → 403', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOKEN`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await POST(postReq(bearer, { recipient: VALID_AGE, kind: 'AGE_X25519', label: 'l' }));
    expect(res.status).toBe(403);
    expect(fakePrisma.userRecipient.create).not.toHaveBeenCalled();
  });

  test('invalid JSON → 400', async () => {
    await stageUserAuth('user-bearer');
    const r = new Request('https://envstore.xyz/api/v1/me/recipients', {
      method: 'POST',
      headers: { authorization: 'Bearer user-bearer', 'content-type': 'application/json' },
      body: 'not-json{',
    });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });

  test('missing label → 400', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(postReq('user-bearer', { recipient: VALID_AGE, kind: 'AGE_X25519' }));
    expect(res.status).toBe(400);
  });

  test('malformed recipient → 400 (server-side parseRecipient)', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(
      postReq('user-bearer', { recipient: 'age1-broken', kind: 'AGE_X25519', label: 'l' }),
    );
    expect(res.status).toBe(400);
    expect(fakePrisma.userRecipient.create).not.toHaveBeenCalled();
  });

  test('kind mismatch (looks like age but claims SSH) → 400', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(
      postReq('user-bearer', { recipient: VALID_AGE, kind: 'SSH_ED25519', label: 'l' }),
    );
    expect(res.status).toBe(400);
    expect(fakePrisma.userRecipient.create).not.toHaveBeenCalled();
  });
});

describe('POST /me/recipients — cap + idempotency', () => {
  test('at cap → 409, no row created', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.count.mockResolvedValueOnce(LIMITS.maxRecipientsPerUser);
    const res = await POST(
      postReq('user-bearer', { recipient: VALID_AGE, kind: 'AGE_X25519', label: 'l' }),
    );
    expect(res.status).toBe(409);
    expect(fakePrisma.userRecipient.create).not.toHaveBeenCalled();
  });

  test('duplicate (same userId+recipient) returns 200, updates label if changed', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.count.mockResolvedValueOnce(1);
    fakePrisma.userRecipient.findUnique.mockResolvedValueOnce({
      id: 'rec_existing',
      recipient: VALID_AGE,
      kind: 'AGE_X25519',
      label: 'old',
    });

    const res = await POST(
      postReq('user-bearer', { recipient: VALID_AGE, kind: 'AGE_X25519', label: 'new' }),
    );
    expect(res.status).toBe(200);
    expect(fakePrisma.userRecipient.create).not.toHaveBeenCalled();
    expect(fakePrisma.userRecipient.update).toHaveBeenCalledTimes(1);
    const args = fakePrisma.userRecipient.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { label: string };
    };
    expect(args.where.id).toBe('rec_existing');
    expect(args.data.label).toBe('new');
  });

  test('duplicate with unchanged label → 200, no update fired', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.count.mockResolvedValueOnce(1);
    fakePrisma.userRecipient.findUnique.mockResolvedValueOnce({
      id: 'rec_existing',
      recipient: VALID_AGE,
      kind: 'AGE_X25519',
      label: 'same',
    });
    const res = await POST(
      postReq('user-bearer', { recipient: VALID_AGE, kind: 'AGE_X25519', label: 'same' }),
    );
    expect(res.status).toBe(200);
    expect(fakePrisma.userRecipient.update).not.toHaveBeenCalled();
  });

  test('new recipient → 201, row scoped to caller, audit recorded', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.userRecipient.create.mockResolvedValueOnce({
      id: 'rec_new',
      recipient: VALID_AGE,
      kind: 'AGE_X25519',
      label: 'laptop',
    });
    const res = await POST(
      postReq('user-bearer', { recipient: VALID_AGE, kind: 'AGE_X25519', label: 'laptop' }),
    );
    expect(res.status).toBe(201);
    const createArgs = fakePrisma.userRecipient.create.mock.calls[0]?.[0] as {
      data: { userId: string; recipient: string };
    };
    expect(createArgs.data.userId).toBe('u_1');
    expect(createArgs.data.recipient).toBe(VALID_AGE);
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
