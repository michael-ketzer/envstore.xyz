// Tests for CLI token issuance.
//
// Two invariants we pin:
//   1. Only the sha256 hash hits the DB — the plaintext is in the response
//      object once and never persisted.
//   2. Per-user cap: when at the cap, the OLDEST token is revoked to make
//      room. The "oldest" tie-break is `lastUsedAt ASC, createdAt ASC`,
//      which prevents a forgotten CI runner from forever-blocking new
//      logins from human terminals.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  cliToken: { count: mock(), findFirst: mock(), create: mock(), delete: mock(), deleteMany: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { issueCliToken, revokeCliToken, generateCliToken } = await import('./cli-tokens');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.cliToken.create.mockImplementation(async () => ({ id: 'tok_new' }));
  fakePrisma.cliToken.count.mockResolvedValue(0);
});

describe('generateCliToken', () => {
  test('has the est_ prefix', () => {
    expect(generateCliToken().startsWith('est_')).toBe(true);
  });

  test('two calls return different tokens (random source not deterministic)', () => {
    expect(generateCliToken()).not.toBe(generateCliToken());
  });

  test('post-prefix payload is base64url (no padding, URL-safe)', () => {
    const t = generateCliToken();
    const body = t.slice('est_'.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes → 43 base64url chars (no padding).
    expect(body.length).toBe(43);
  });
});

describe('issueCliToken', () => {
  test('persists only the sha256 hash; plaintext is in the result', async () => {
    const r = await issueCliToken({ userId: 'u_1', name: 'macbook' });
    expect(r.token.startsWith('est_')).toBe(true);
    expect(r.cliTokenId).toBe('tok_new');

    const createArgs = fakePrisma.cliToken.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string };
    };
    expect(createArgs.data.tokenHash).toBe(await sha256Hex(r.token));
    // Plaintext token MUST NOT appear in any DB field.
    expect(JSON.stringify(createArgs.data)).not.toContain(r.token);
  });

  test('truncates token name to 80 chars', async () => {
    await issueCliToken({ userId: 'u_1', name: 'x'.repeat(200) });
    const createArgs = fakePrisma.cliToken.create.mock.calls[0]?.[0] as {
      data: { name: string };
    };
    expect(createArgs.data.name.length).toBe(80);
  });

  test('default expiry is ~90 days from now', async () => {
    const before = Date.now();
    await issueCliToken({ userId: 'u_1', name: 'cli' });
    const createArgs = fakePrisma.cliToken.create.mock.calls[0]?.[0] as {
      data: { expiresAt: Date };
    };
    const ninetyDays = before + 90 * 24 * 60 * 60 * 1000;
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(ninetyDays - 10_000);
    expect(createArgs.data.expiresAt.getTime()).toBeLessThan(ninetyDays + 10_000);
  });

  test('user under cap → no revocation, just create', async () => {
    fakePrisma.cliToken.count.mockResolvedValueOnce(5);
    await issueCliToken({ userId: 'u_1', name: 'cli' });
    expect(fakePrisma.cliToken.findFirst).not.toHaveBeenCalled();
    expect(fakePrisma.cliToken.delete).not.toHaveBeenCalled();
  });

  test('user AT cap → oldest token revoked first', async () => {
    fakePrisma.cliToken.count.mockResolvedValueOnce(20);
    fakePrisma.cliToken.findFirst.mockResolvedValueOnce({ id: 'tok_oldest' });

    await issueCliToken({ userId: 'u_1', name: 'cli' });
    expect(fakePrisma.cliToken.delete).toHaveBeenCalledTimes(1);
    const args = fakePrisma.cliToken.delete.mock.calls[0]?.[0] as { where: { id: string } };
    expect(args.where.id).toBe('tok_oldest');

    // "Oldest" must be selected by lastUsedAt asc, createdAt asc — the LRU
    // semantics that prevent a stale-but-not-used token from blocking new
    // logins forever.
    const findArgs = fakePrisma.cliToken.findFirst.mock.calls[0]?.[0] as {
      where: { userId: string };
      orderBy: Array<Record<string, string>>;
    };
    expect(findArgs.where.userId).toBe('u_1');
    expect(findArgs.orderBy[0]).toEqual({ lastUsedAt: 'asc' });
    expect(findArgs.orderBy[1]).toEqual({ createdAt: 'asc' });
  });

  test('user AT cap but no eligible victim (zero tokens, count lies) → continues without delete', async () => {
    fakePrisma.cliToken.count.mockResolvedValueOnce(20);
    fakePrisma.cliToken.findFirst.mockResolvedValueOnce(null);
    await issueCliToken({ userId: 'u_1', name: 'cli' });
    expect(fakePrisma.cliToken.delete).not.toHaveBeenCalled();
    expect(fakePrisma.cliToken.create).toHaveBeenCalledTimes(1);
  });
});

describe('revokeCliToken', () => {
  test('matching id+user → true, deleteMany scopes by both', async () => {
    fakePrisma.cliToken.deleteMany.mockResolvedValueOnce({ count: 1 });
    const ok = await revokeCliToken('tok_1', 'u_1');
    expect(ok).toBe(true);
    const args = fakePrisma.cliToken.deleteMany.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    // Both scoping fields must be present — id alone would let a caller
    // delete tokens owned by other users.
    expect(args.where.id).toBe('tok_1');
    expect(args.where.userId).toBe('u_1');
  });

  test('no match → false (no leak about whose token it was)', async () => {
    fakePrisma.cliToken.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await revokeCliToken('tok_other', 'u_1')).toBe(false);
  });
});
