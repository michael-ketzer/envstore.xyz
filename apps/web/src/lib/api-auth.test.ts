// Direct tests for the bearer-auth helpers. Every /api/v1/* route funnels
// through `authenticateBearer`, so the discriminator + revocation/expiry
// gates here are the load-bearing piece of the API's authz story.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  workspace: { findFirst: mock() },
};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const {
  authenticateBearer,
  requireUserAuth,
  resolveWorkspaceForAuth,
  tokenAllowsProject,
  auditFieldsFor,
} = await import('./api-auth');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
});

function withBearer(bearer: string | null): Request {
  const headers: Record<string, string> = {};
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
  return new Request('https://envstore.xyz/api/v1/x', { method: 'GET', headers });
}

function cliTokenRow(tokenHash: string, opts: { expiresAt?: Date | null } = {}) {
  return {
    id: 'tok_1',
    userId: 'u_1',
    name: 'cli',
    tokenHash,
    lastUsedAt: null,
    expiresAt: opts.expiresAt ?? null,
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
}

function wsTokenRow(
  tokenHash: string,
  opts: { revokedAt?: Date | null; expiresAt?: Date | null; scopedProjectIds?: string[] } = {},
) {
  return {
    id: 'wstok_1',
    workspaceId: 'ws_1',
    name: 'ci',
    tokenHash,
    recipient: 'age1stub',
    recipientKind: 'AGE_X25519',
    scopes: ['read', 'write'],
    scopedProjectIds: opts.scopedProjectIds ?? [],
    expiresAt: opts.expiresAt ?? null,
    revokedAt: opts.revokedAt ?? null,
    lastUsedAt: null,
    createdByUserId: 'u_admin',
    createdAt: new Date(),
  };
}

describe('authenticateBearer — header shape', () => {
  test('missing Authorization header → null', async () => {
    const res = await authenticateBearer(withBearer(null));
    expect(res).toBeNull();
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.workspaceToken.findUnique).not.toHaveBeenCalled();
  });

  test('Authorization without "Bearer " prefix → null', async () => {
    const r = new Request('https://envstore.xyz/api/v1/x', {
      method: 'GET',
      headers: { authorization: 'Basic abc' },
    });
    expect(await authenticateBearer(r)).toBeNull();
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
  });

  test('"Bearer" with empty token → null without DB lookup', async () => {
    expect(await authenticateBearer(withBearer(''))).toBeNull();
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
  });

  test('token longer than 200 chars → null without DB lookup (DoS guard)', async () => {
    const huge = 'a'.repeat(201);
    expect(await authenticateBearer(withBearer(huge))).toBeNull();
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.workspaceToken.findUnique).not.toHaveBeenCalled();
  });
});

describe('authenticateBearer — CLI token branch', () => {
  test('valid CLI token → AuthedUser, fires lastUsedAt update', async () => {
    const bearer = 'a'.repeat(32);
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(cliTokenRow(tokenHash));

    const auth = await authenticateBearer(withBearer(bearer));
    expect(auth?.kind).toBe('user');
    if (auth?.kind === 'user') {
      expect(auth.user.email).toBe('alice@example.com');
      // `user` is stripped off the cliToken row before being returned.
      expect((auth.cliToken as { user?: unknown }).user).toBeUndefined();
    }
    expect(fakePrisma.cliToken.update).toHaveBeenCalledTimes(1);
    expect(fakePrisma.workspaceToken.findUnique).not.toHaveBeenCalled();
  });

  test('unknown CLI token → null', async () => {
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(null);
    expect(await authenticateBearer(withBearer('ghost'))).toBeNull();
    expect(fakePrisma.cliToken.update).not.toHaveBeenCalled();
  });

  test('expired CLI token → null (does NOT touch lastUsedAt)', async () => {
    const bearer = 'a'.repeat(32);
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(
      cliTokenRow(tokenHash, { expiresAt: new Date(Date.now() - 60_000) }),
    );
    expect(await authenticateBearer(withBearer(bearer))).toBeNull();
    expect(fakePrisma.cliToken.update).not.toHaveBeenCalled();
  });

  test('CLI token with future expiry → AuthedUser', async () => {
    const bearer = 'b'.repeat(32);
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(
      cliTokenRow(tokenHash, { expiresAt: new Date(Date.now() + 60_000) }),
    );
    expect((await authenticateBearer(withBearer(bearer)))?.kind).toBe('user');
  });

  test('fire-and-forget lastUsedAt failure must not crash auth', async () => {
    const bearer = 'c'.repeat(32);
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.cliToken.findUnique.mockResolvedValueOnce(cliTokenRow(tokenHash));
    fakePrisma.cliToken.update.mockRejectedValueOnce(new Error('boom'));
    const auth = await authenticateBearer(withBearer(bearer));
    expect(auth?.kind).toBe('user');
  });
});

describe('authenticateBearer — workspace-token branch', () => {
  test('valid workspace token → AuthedWorkspaceToken, never hits cliToken table', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}XYZ123`;
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.workspaceToken.findUnique.mockResolvedValueOnce(wsTokenRow(tokenHash));

    const auth = await authenticateBearer(withBearer(bearer));
    expect(auth?.kind).toBe('workspace-token');
    if (auth?.kind === 'workspace-token') {
      expect(auth.workspaceId).toBe('ws_1');
      expect(auth.token.id).toBe('wstok_1');
    }
    // Prefix discrimination must skip the CLI lookup entirely.
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.workspaceToken.update).toHaveBeenCalledTimes(1);
  });

  test('revoked workspace token → null', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}REV`;
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.workspaceToken.findUnique.mockResolvedValueOnce(
      wsTokenRow(tokenHash, { revokedAt: new Date() }),
    );
    expect(await authenticateBearer(withBearer(bearer))).toBeNull();
    expect(fakePrisma.workspaceToken.update).not.toHaveBeenCalled();
  });

  test('expired workspace token → null', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}EXP`;
    const tokenHash = await sha256Hex(bearer);
    fakePrisma.workspaceToken.findUnique.mockResolvedValueOnce(
      wsTokenRow(tokenHash, { expiresAt: new Date(Date.now() - 60_000) }),
    );
    expect(await authenticateBearer(withBearer(bearer))).toBeNull();
  });

  test('unknown workspace token → null', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}NOPE`;
    fakePrisma.workspaceToken.findUnique.mockResolvedValueOnce(null);
    expect(await authenticateBearer(withBearer(bearer))).toBeNull();
    // Critical: a workspace-prefixed token must NEVER fall through to the
    // CLI table — otherwise a forged "eswtok_<32-hex>" could collide with a
    // real user token hash and authenticate as that user.
    expect(fakePrisma.cliToken.findUnique).not.toHaveBeenCalled();
  });
});

describe('requireUserAuth', () => {
  test('user auth → passes through', () => {
    const userAuth = {
      kind: 'user' as const,
      user: { id: 'u_1' } as never,
      cliToken: { id: 'tok_1' } as never,
    };
    const res = requireUserAuth(userAuth);
    expect(res).toBe(userAuth);
  });

  test('workspace-token auth → 403 Response', async () => {
    const res = requireUserAuth({
      kind: 'workspace-token',
      token: { id: 'wstok_1' } as never,
      workspaceId: 'ws_1',
    });
    expect(res).toBeInstanceOf(Response);
    if (res instanceof Response) {
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/service tokens cannot/i);
    }
  });
});

describe('tokenAllowsProject', () => {
  test('user auth always passes', () => {
    expect(
      tokenAllowsProject(
        { kind: 'user', user: { id: 'u' } as never, cliToken: {} as never },
        'proj_anything',
      ),
    ).toBe(true);
  });

  test('workspace-wide token (empty scope) passes any project', () => {
    expect(
      tokenAllowsProject(
        {
          kind: 'workspace-token',
          token: { scopedProjectIds: [] } as never,
          workspaceId: 'ws_1',
        },
        'proj_x',
      ),
    ).toBe(true);
  });

  test('project-scoped token passes only listed projects', () => {
    const auth = {
      kind: 'workspace-token' as const,
      token: { scopedProjectIds: ['proj_api', 'proj_billing'] } as never,
      workspaceId: 'ws_1',
    };
    expect(tokenAllowsProject(auth, 'proj_api')).toBe(true);
    expect(tokenAllowsProject(auth, 'proj_billing')).toBe(true);
    expect(tokenAllowsProject(auth, 'proj_other')).toBe(false);
  });
});

describe('resolveWorkspaceForAuth', () => {
  test('user auth → finds by slug + membership + not-deleted', async () => {
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1', slug: 'acme' });
    const auth = {
      kind: 'user' as const,
      user: { id: 'u_1' } as never,
      cliToken: {} as never,
    };
    const ws = await resolveWorkspaceForAuth(auth, 'acme');
    expect(ws?.slug).toBe('acme');
    const call = fakePrisma.workspace.findFirst.mock.calls[0]?.[0] as {
      where: { slug: string; deletedAt: null; members: { some: { userId: string } } };
    };
    expect(call.where.slug).toBe('acme');
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.members.some.userId).toBe('u_1');
  });

  test('user auth → null if not a member (route renders 404, no existence leak)', async () => {
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    const auth = {
      kind: 'user' as const,
      user: { id: 'u_1' } as never,
      cliToken: {} as never,
    };
    expect(await resolveWorkspaceForAuth(auth, 'private')).toBeNull();
  });

  test('workspace-token → matches slug AND the token-bound workspaceId', async () => {
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1', slug: 'acme' });
    const auth = {
      kind: 'workspace-token' as const,
      token: { id: 'wstok_1' } as never,
      workspaceId: 'ws_1',
    };
    const ws = await resolveWorkspaceForAuth(auth, 'acme');
    expect(ws?.id).toBe('ws_1');
    const call = fakePrisma.workspace.findFirst.mock.calls[0]?.[0] as {
      where: { slug: string; id: string };
    };
    // Token must be locked to its own workspace — even if the caller can
    // guess another workspace's slug, the `id: workspaceId` clause prevents
    // cross-workspace access.
    expect(call.where.slug).toBe('acme');
    expect(call.where.id).toBe('ws_1');
  });

  test('workspace-token + slug pointing at a different workspace → null', async () => {
    // findFirst returns null because the slug+id pair doesn't match.
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    const auth = {
      kind: 'workspace-token' as const,
      token: { id: 'wstok_1' } as never,
      workspaceId: 'ws_1',
    };
    expect(await resolveWorkspaceForAuth(auth, 'other-ws')).toBeNull();
  });
});

describe('auditFieldsFor', () => {
  test('user auth → userId set, workspaceTokenId null', () => {
    const f = auditFieldsFor({
      kind: 'user',
      user: { id: 'u_1' } as never,
      cliToken: {} as never,
    });
    expect(f).toEqual({ userId: 'u_1', workspaceTokenId: null });
  });

  test('workspace-token auth → workspaceTokenId set, userId null', () => {
    const f = auditFieldsFor({
      kind: 'workspace-token',
      token: { id: 'wstok_1' } as never,
      workspaceId: 'ws_1',
    });
    expect(f).toEqual({ userId: null, workspaceTokenId: 'wstok_1' });
  });
});
