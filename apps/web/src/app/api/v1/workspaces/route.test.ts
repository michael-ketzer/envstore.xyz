// POST /api/v1/workspaces — create a team workspace.
//
// Auth invariant: workspace tokens cannot mint workspaces (would let a CI
// token escalate to a fresh untracked workspace under any user's name).
// Slug-conflict and validation errors map to distinct HTTP codes so the
// CLI can show actionable messages.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

const fakeCreate = mock();

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/workspaces', () => ({
  createTeamWorkspace: fakeCreate,
}));

const { POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeCreate.mockReset();
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
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
  return new Request('https://envstore.xyz/api/v1/workspaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /workspaces', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await POST(r)).status).toBe(401);
    expect(fakeCreate).not.toHaveBeenCalled();
  });

  test('workspace-token → 403 (a service token cannot mint a new workspace)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer);
    const res = await POST(postReq(bearer, { name: 'New', slug: 'new' }));
    expect(res.status).toBe(403);
    expect(fakeCreate).not.toHaveBeenCalled();
  });

  test('invalid JSON → 400', async () => {
    await stageUserAuth('user-bearer');
    const r = new Request('https://envstore.xyz/api/v1/workspaces', {
      method: 'POST',
      headers: { authorization: 'Bearer user-bearer', 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect((await POST(r)).status).toBe(400);
  });

  test('missing name → 400, no create', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(postReq('user-bearer', { slug: 'acme' }));
    expect(res.status).toBe(400);
    expect(fakeCreate).not.toHaveBeenCalled();
  });

  test('slug already taken → 409', async () => {
    await stageUserAuth('user-bearer');
    fakeCreate.mockResolvedValueOnce({
      ok: false,
      reason: 'slug-taken',
      message: 'Slug already in use.',
    });
    const res = await POST(postReq('user-bearer', { name: 'Acme', slug: 'acme' }));
    expect(res.status).toBe(409);
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('reserved/invalid slug from the helper → 400 (other failure reasons)', async () => {
    await stageUserAuth('user-bearer');
    fakeCreate.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid',
      message: 'Slug is reserved.',
    });
    const res = await POST(postReq('user-bearer', { name: 'Admin', slug: 'admin' }));
    expect(res.status).toBe(400);
  });

  test('user → 201, returns slug+name+type+role, audit recorded', async () => {
    await stageUserAuth('user-bearer');
    fakeCreate.mockResolvedValueOnce({
      ok: true,
      workspace: { id: 'ws_new', slug: 'acme' },
    });
    const res = await POST(postReq('user-bearer', { name: 'Acme', slug: 'acme' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ slug: 'acme', name: 'Acme', type: 'TEAM', role: 'OWNER' });

    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; userId: string; workspaceId: string };
    };
    expect(audit.data.action).toBe('workspace.create');
    expect(audit.data.userId).toBe('u_1');
    expect(audit.data.workspaceId).toBe('ws_new');
  });
});
