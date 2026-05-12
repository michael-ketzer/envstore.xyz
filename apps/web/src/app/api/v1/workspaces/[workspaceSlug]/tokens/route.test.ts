// Tests for POST/GET /api/v1/workspaces/[ws]/tokens.
//
// Two invariants we explicitly defend:
//   1. Service tokens cannot mint other tokens (`requireUserAuth` → 403).
//      A leaked CI token must not become a foothold for spawning credentials.
//   2. Only ADMIN/OWNER may mint or list; MEMBER → 403. Tokens carry
//      workspace-wide read/write power.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  workspaceMember: { findUnique: mock() },
  workspaceToken: {
    findUnique: mock(),
    findMany: mock(),
    findFirst: mock(),
    create: mock(),
    update: mock(),
  },
  cliToken: { findUnique: mock(), update: mock() },
  project: { findMany: mock() },
  auditLog: { create: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const VALID_AGE_RECIPIENT =
  'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

const { GET, POST } = await import('./route');

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
      recipient: VALID_AGE_RECIPIENT,
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
  if (role === null) {
    fakePrisma.workspaceMember.findUnique.mockResolvedValue(null);
  } else {
    fakePrisma.workspaceMember.findUnique.mockResolvedValue({ role });
  }
}

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme' }) };

function postReq(bearer: string, body: unknown): Request {
  return new Request('https://envstore.xyz/api/v1/workspaces/acme/tokens', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(bearer: string): Request {
  return new Request('https://envstore.xyz/api/v1/workspaces/acme/tokens', {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer}` },
  });
}

describe('POST /tokens — auth gates', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/workspaces/acme/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await POST(r, ctx);
    expect(res.status).toBe(401);
  });

  test('service token → 403 (tokens cannot mint tokens)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}CALLER`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await POST(postReq(bearer, { name: 'x', recipient: VALID_AGE_RECIPIENT }), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
    expect(fakePrisma.workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  test('user but not a member → 404', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    const res = await POST(postReq('user-bearer', { name: 'x', recipient: VALID_AGE_RECIPIENT }), ctx);
    expect(res.status).toBe(404);
  });

  test('member but not admin → 403', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('MEMBER');
    const res = await POST(postReq('user-bearer', { name: 'x', recipient: VALID_AGE_RECIPIENT }), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });

  test('admin → 201, returns bearer once, audit recorded', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakePrisma.workspaceToken.create.mockResolvedValueOnce({
      id: 'wstok_new',
      name: 'ci',
      recipient: VALID_AGE_RECIPIENT,
      scopes: ['read', 'write'],
      expiresAt: null,
      createdAt: new Date(),
    });

    const res = await POST(postReq('user-bearer', { name: 'ci', recipient: VALID_AGE_RECIPIENT }), ctx);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.token).toBe('string');
    expect((body.token as string).startsWith(WORKSPACE_TOKEN_PREFIX)).toBe(true);
    expect(body.id).toBe('wstok_new');

    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; userId: string };
    };
    expect(audit.data.action).toBe('workspaceToken.create');
    expect(audit.data.userId).toBe('u_1');
  });

  test('owner → 201 (OWNER passes the >= ADMIN gate)', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('OWNER');
    fakePrisma.workspaceToken.create.mockResolvedValueOnce({
      id: 'wstok_owner',
      name: 'ci',
      recipient: VALID_AGE_RECIPIENT,
      scopes: ['read', 'write'],
      expiresAt: null,
      createdAt: new Date(),
    });
    const res = await POST(postReq('user-bearer', { name: 'ci', recipient: VALID_AGE_RECIPIENT }), ctx);
    expect(res.status).toBe(201);
  });
});

describe('POST /tokens — validation', () => {
  test('invalid JSON body → 400', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    const r = new Request('https://envstore.xyz/api/v1/workspaces/acme/tokens', {
      method: 'POST',
      headers: { authorization: 'Bearer user-bearer', 'content-type': 'application/json' },
      body: 'not-json{',
    });
    const res = await POST(r, ctx);
    expect(res.status).toBe(400);
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });

  test('missing name → 400', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    const res = await POST(postReq('user-bearer', { recipient: VALID_AGE_RECIPIENT }), ctx);
    expect(res.status).toBe(400);
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });

  test('malformed age recipient → 400', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    const res = await POST(
      postReq('user-bearer', { name: 'ci', recipient: 'age1-malformed' }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });

  test('unknown project slug → 400, no token created', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakePrisma.project.findMany.mockResolvedValueOnce([]);
    const res = await POST(
      postReq('user-bearer', {
        name: 'ci',
        recipient: VALID_AGE_RECIPIENT,
        projects: ['ghost'],
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('ghost');
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });
});

describe('GET /tokens — auth + list', () => {
  test('service token → 403 (cannot enumerate other tokens)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}CALLER`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await GET(getReq(bearer), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceToken.findMany).not.toHaveBeenCalled();
  });

  test('member (non-admin) → 403', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('MEMBER');
    const res = await GET(getReq('user-bearer'), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.workspaceToken.findMany).not.toHaveBeenCalled();
  });

  test('admin → 200, body contains tokens array with no bearer in any item', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakePrisma.workspaceToken.findMany.mockResolvedValueOnce([
      {
        id: 'wstok_1',
        name: 'ci',
        tokenHash: 'secret-hash',
        recipient: VALID_AGE_RECIPIENT,
        scopes: ['read', 'write'],
        scopedProjectIds: [],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        createdBy: { email: 'admin@example.com' },
      },
    ]);
    const res = await GET(getReq('user-bearer'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: Record<string, unknown>[] };
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]!.id).toBe('wstok_1');
    expect(body.tokens[0]!.token).toBeUndefined();
    expect(body.tokens[0]!.tokenHash).toBeUndefined();
    expect(body.tokens[0]!.bearer).toBeUndefined();
  });
});
