// Tests for the workspace-token mint/list/revoke helpers.
//
// Bearer-hash hygiene: we assert that the bearer is generated, sha256-hashed,
// and persisted ONLY as the hash. The `bearer` field of the result is the
// only place the cleartext exists post-create.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspaceToken: {
    findUnique: mock(),
    findMany: mock(),
    findFirst: mock(),
    create: mock(),
    update: mock(),
  },
  project: { findMany: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

// age recipient parsing is loaded from @envstore/crypto; we use a real-ish
// age public key so the structural check passes. parseRecipient throws on
// invalid input — that's the failure path under test.
const VALID_AGE_RECIPIENT =
  'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

const {
  createWorkspaceToken,
  listWorkspaceTokens,
  revokeWorkspaceToken,
} = await import('./workspace-tokens');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.workspaceToken.findUnique.mockResolvedValue(null);
  fakePrisma.workspaceToken.findMany.mockResolvedValue([]);
  fakePrisma.project.findMany.mockResolvedValue([]);
});

describe('createWorkspaceToken', () => {
  test('mints a bearer, sha-hashes it, persists only the hash', async () => {
    fakePrisma.workspaceToken.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'wstok_new',
      name: args.data.name,
      recipient: args.data.recipient,
      scopes: ['read', 'write'],
      expiresAt: args.data.expiresAt,
      createdAt: new Date(),
    }));

    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: { name: 'ci', recipient: VALID_AGE_RECIPIENT },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.bearer.startsWith(WORKSPACE_TOKEN_PREFIX)).toBe(true);
    // Prefix(7) + 32 bytes -> 52 base32 chars => 59 total.
    expect(result.bearer.length).toBe(59);

    const createArgs = fakePrisma.workspaceToken.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string; recipientKind: string; scopedProjectIds: string[] };
    };
    // Stored tokenHash must equal sha256(bearer) — never the cleartext.
    expect(createArgs.data.tokenHash).toBe(await sha256Hex(result.bearer));
    expect(createArgs.data.recipientKind).toBe('AGE_X25519');
    expect(createArgs.data.scopedProjectIds).toEqual([]);
  });

  test('invalid recipient → ok:false invalid-recipient (no DB write)', async () => {
    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: { name: 'ci', recipient: 'not-a-real-recipient' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('invalid-recipient');
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });

  test('unknown project slug → ok:false unknown-project (no DB write)', async () => {
    // Only one of the two requested slugs exists in this workspace.
    fakePrisma.project.findMany.mockResolvedValueOnce([
      { id: 'proj_api', slug: 'api', name: 'API' },
    ]);
    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: {
        name: 'ci',
        recipient: VALID_AGE_RECIPIENT,
        projects: ['api', 'ghost'],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('unknown-project');
    expect(result.message).toContain('ghost');
    expect(result.message).not.toContain('api');
    expect(fakePrisma.workspaceToken.create).not.toHaveBeenCalled();
  });

  test('project scope is resolved to IDs, not slugs (immutable under rename)', async () => {
    fakePrisma.project.findMany.mockResolvedValueOnce([
      { id: 'proj_api', slug: 'api', name: 'API' },
      { id: 'proj_billing', slug: 'billing', name: 'Billing' },
    ]);
    fakePrisma.workspaceToken.create.mockResolvedValueOnce({
      id: 'wstok_new',
      name: 'scoped',
      recipient: VALID_AGE_RECIPIENT,
      scopes: ['read', 'write'],
      expiresAt: null,
      createdAt: new Date(),
    });

    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: {
        name: 'scoped',
        recipient: VALID_AGE_RECIPIENT,
        projects: ['api', 'billing'],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const createArgs = fakePrisma.workspaceToken.create.mock.calls[0]?.[0] as {
      data: { scopedProjectIds: string[] };
    };
    expect(createArgs.data.scopedProjectIds.sort()).toEqual(['proj_api', 'proj_billing']);
    expect(result.token.scopedProjects.map((p) => p.slug).sort()).toEqual(['api', 'billing']);
  });

  test('expiresInDays caps at 365 days even when caller asks more', async () => {
    fakePrisma.workspaceToken.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'wstok_capped',
      name: args.data.name,
      recipient: args.data.recipient,
      scopes: ['read', 'write'],
      expiresAt: args.data.expiresAt,
      createdAt: new Date(),
    }));

    const before = Date.now();
    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: { name: 'forever', recipient: VALID_AGE_RECIPIENT, expiresInDays: 9999 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const createArgs = fakePrisma.workspaceToken.create.mock.calls[0]?.[0] as {
      data: { expiresAt: Date };
    };
    const expectedMax = before + 365 * 24 * 60 * 60 * 1000;
    // Generous upper bound — within a couple seconds is fine.
    expect(createArgs.data.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax + 5_000);
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(before);
  });

  test('default expiry is 90 days when expiresInDays omitted', async () => {
    fakePrisma.workspaceToken.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'wstok',
      name: args.data.name,
      recipient: args.data.recipient,
      scopes: ['read', 'write'],
      expiresAt: args.data.expiresAt,
      createdAt: new Date(),
    }));

    const before = Date.now();
    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: { name: 'default', recipient: VALID_AGE_RECIPIENT },
    });
    expect(result.ok).toBe(true);

    const createArgs = fakePrisma.workspaceToken.create.mock.calls[0]?.[0] as {
      data: { expiresAt: Date };
    };
    const expected90d = before + 90 * 24 * 60 * 60 * 1000;
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(expected90d - 5_000);
    expect(createArgs.data.expiresAt.getTime()).toBeLessThan(expected90d + 5_000);
  });

  test('retries on tokenHash collision (cosmic-ray case)', async () => {
    // Pretend the first two generated bearers already exist; third is fresh.
    let calls = 0;
    fakePrisma.workspaceToken.findUnique.mockImplementation(async () => {
      calls += 1;
      return calls <= 2 ? { id: 'clash' } : null;
    });
    fakePrisma.workspaceToken.create.mockResolvedValueOnce({
      id: 'wstok_new',
      name: 'ci',
      recipient: VALID_AGE_RECIPIENT,
      scopes: ['read', 'write'],
      expiresAt: null,
      createdAt: new Date(),
    });

    const result = await createWorkspaceToken({
      workspaceId: 'ws_1',
      createdByUserId: 'u_admin',
      input: { name: 'ci', recipient: VALID_AGE_RECIPIENT },
    });
    expect(result.ok).toBe(true);
    expect(fakePrisma.workspaceToken.findUnique).toHaveBeenCalledTimes(3);
    expect(fakePrisma.workspaceToken.create).toHaveBeenCalledTimes(1);
  });
});

describe('listWorkspaceTokens', () => {
  test('returns tokens with project slug+name resolved, no bearer', async () => {
    fakePrisma.workspaceToken.findMany.mockResolvedValueOnce([
      {
        id: 'wstok_1',
        name: 'ci',
        tokenHash: 'hash1',
        recipient: VALID_AGE_RECIPIENT,
        scopes: ['read', 'write'],
        scopedProjectIds: ['proj_api'],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-01-01'),
        createdBy: { email: 'admin@example.com' },
      },
    ]);
    fakePrisma.project.findMany.mockResolvedValueOnce([
      { id: 'proj_api', slug: 'api', name: 'API' },
    ]);

    const tokens = await listWorkspaceTokens('ws_1');
    expect(tokens).toHaveLength(1);
    const t = tokens[0]!;
    expect(t.id).toBe('wstok_1');
    expect(t.scopedProjects).toEqual([{ slug: 'api', name: 'API' }]);
    expect(t.createdByEmail).toBe('admin@example.com');
    // Bearer/tokenHash MUST NOT leak in list output.
    expect((t as Record<string, unknown>).token).toBeUndefined();
    expect((t as Record<string, unknown>).bearer).toBeUndefined();
    expect((t as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  test('drops scopedProjectIds whose projects no longer exist', async () => {
    fakePrisma.workspaceToken.findMany.mockResolvedValueOnce([
      {
        id: 'wstok_1',
        name: 'ci',
        tokenHash: 'h',
        recipient: VALID_AGE_RECIPIENT,
        scopes: ['read', 'write'],
        scopedProjectIds: ['proj_api', 'proj_deleted'],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        createdBy: null,
      },
    ]);
    fakePrisma.project.findMany.mockResolvedValueOnce([
      { id: 'proj_api', slug: 'api', name: 'API' },
    ]);

    const tokens = await listWorkspaceTokens('ws_1');
    expect(tokens[0]!.scopedProjects).toEqual([{ slug: 'api', name: 'API' }]);
  });

  test('bulk-resolves projects in a single findMany (no N+1)', async () => {
    fakePrisma.workspaceToken.findMany.mockResolvedValueOnce([
      {
        id: 'a',
        name: 'a',
        tokenHash: 'h',
        recipient: VALID_AGE_RECIPIENT,
        scopes: [],
        scopedProjectIds: ['p1', 'p2'],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        createdBy: null,
      },
      {
        id: 'b',
        name: 'b',
        tokenHash: 'h',
        recipient: VALID_AGE_RECIPIENT,
        scopes: [],
        scopedProjectIds: ['p2', 'p3'],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        createdBy: null,
      },
    ]);
    fakePrisma.project.findMany.mockResolvedValueOnce([
      { id: 'p1', slug: 'p1', name: 'P1' },
      { id: 'p2', slug: 'p2', name: 'P2' },
      { id: 'p3', slug: 'p3', name: 'P3' },
    ]);

    await listWorkspaceTokens('ws_1');
    expect(fakePrisma.project.findMany).toHaveBeenCalledTimes(1);
    const args = fakePrisma.project.findMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } };
    };
    expect(args.where.id.in.sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('revokeWorkspaceToken', () => {
  test('marks an active token as revoked', async () => {
    fakePrisma.workspaceToken.findFirst.mockResolvedValueOnce({
      id: 'wstok_1',
      revokedAt: null,
    });
    fakePrisma.workspaceToken.update.mockResolvedValueOnce({});

    const result = await revokeWorkspaceToken('ws_1', 'wstok_1');
    expect(result).toEqual({ ok: true });
    expect(fakePrisma.workspaceToken.update).toHaveBeenCalledTimes(1);
    const args = fakePrisma.workspaceToken.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { revokedAt: Date };
    };
    expect(args.where.id).toBe('wstok_1');
    expect(args.data.revokedAt).toBeInstanceOf(Date);
  });

  test('idempotent — already-revoked stays at the original revokedAt', async () => {
    fakePrisma.workspaceToken.findFirst.mockResolvedValueOnce({
      id: 'wstok_1',
      revokedAt: new Date('2026-01-01'),
    });
    const result = await revokeWorkspaceToken('ws_1', 'wstok_1');
    expect(result).toEqual({ ok: true });
    // Critical: do NOT re-stamp revokedAt on a second revoke — audit trail
    // would otherwise lie about when revocation happened.
    expect(fakePrisma.workspaceToken.update).not.toHaveBeenCalled();
  });

  test('token id from another workspace → not-found (no cross-workspace revoke)', async () => {
    fakePrisma.workspaceToken.findFirst.mockResolvedValueOnce(null);
    const result = await revokeWorkspaceToken('ws_1', 'wstok_other_ws');
    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(fakePrisma.workspaceToken.update).not.toHaveBeenCalled();
    // The findFirst clause must scope by workspaceId.
    const args = fakePrisma.workspaceToken.findFirst.mock.calls[0]?.[0] as {
      where: { id: string; workspaceId: string };
    };
    expect(args.where.workspaceId).toBe('ws_1');
  });
});
