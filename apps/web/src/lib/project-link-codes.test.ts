// Tests for project setup codes (the `envstore link <CODE>` flow).
//
// Notes:
//   - The code is NOT a credential — workspace membership is the actual gate.
//   - The format is human-friendly: 8 chars from a constrained alphabet,
//     displayed as XXXX-XXXX, accepted in any case / with hyphen / spaces.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  project: { findUnique: mock(), update: mock() },
  workspaceMember: { findUnique: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const {
  normalizeLinkCode,
  formatLinkCode,
  ensureLinkCode,
  pickUniqueLinkCode,
  redeemLinkCode,
} = await import('./project-link-codes');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
});

describe('normalizeLinkCode + formatLinkCode', () => {
  test('strips hyphens and whitespace, uppercases', () => {
    expect(normalizeLinkCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeLinkCode('  ab cd  EF gh ')).toBe('ABCDEFGH');
    expect(normalizeLinkCode('abcd efgh\t')).toBe('ABCDEFGH');
  });

  test('format inserts a hyphen at position 4', () => {
    expect(formatLinkCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(formatLinkCode('abcd efgh')).toBe('ABCD-EFGH');
  });
});

describe('pickUniqueLinkCode', () => {
  test('first try wins when no collision', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    const code = await pickUniqueLinkCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(fakePrisma.project.findUnique).toHaveBeenCalledTimes(1);
  });

  test('retries on collision until a fresh code is found', async () => {
    fakePrisma.project.findUnique
      .mockResolvedValueOnce({ id: 'taken' })
      .mockResolvedValueOnce({ id: 'taken' })
      .mockResolvedValueOnce(null);
    const code = await pickUniqueLinkCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(fakePrisma.project.findUnique).toHaveBeenCalledTimes(3);
  });

  test('gives up after 5 attempts (would throw, signaling alphabet exhaustion is real)', async () => {
    fakePrisma.project.findUnique.mockResolvedValue({ id: 'always-taken' });
    await expect(pickUniqueLinkCode()).rejects.toThrow(/unique project link code/);
  });
});

describe('ensureLinkCode', () => {
  test('project already has a code → returns it, no update', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({ linkCode: 'EXISTING1' });
    expect(await ensureLinkCode('proj_1')).toBe('EXISTING1');
    expect(fakePrisma.project.update).not.toHaveBeenCalled();
  });

  test('project has no code → mint one, persist, return it', async () => {
    fakePrisma.project.findUnique
      .mockResolvedValueOnce({ linkCode: null })
      // pickUniqueLinkCode's collision check fires next.
      .mockResolvedValueOnce(null);
    fakePrisma.project.update.mockResolvedValueOnce({});
    const code = await ensureLinkCode('proj_1');
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(fakePrisma.project.update).toHaveBeenCalledTimes(1);
  });

  test('unknown project → throws', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    await expect(ensureLinkCode('proj_ghost')).rejects.toThrow(/not found/);
  });

  test('race: update conflict → re-read and return whatever raced winner saved', async () => {
    fakePrisma.project.findUnique
      .mockResolvedValueOnce({ linkCode: null }) // initial read
      .mockResolvedValueOnce(null) // pickUniqueLinkCode collision check
      .mockResolvedValueOnce({ linkCode: 'WINNER01' }); // post-conflict re-read
    fakePrisma.project.update.mockRejectedValueOnce(new Error('unique constraint'));
    const code = await ensureLinkCode('proj_1');
    expect(code).toBe('WINNER01');
  });
});

describe('redeemLinkCode', () => {
  test('malformed code → not-found (does NOT hit project table)', async () => {
    const r = await redeemLinkCode({ code: 'too-short', userId: 'u_1' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('not-found');
    expect(fakePrisma.project.findUnique).not.toHaveBeenCalled();
  });

  test('unknown code → not-found', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    const r = await redeemLinkCode({ code: 'ABCDEFGH', userId: 'u_1' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('not-found');
  });

  test('soft-deleted project → not-found (treat as deleted, not info leak)', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      slug: 'api',
      deletedAt: new Date(),
      workspaceId: 'ws_1',
      workspace: { id: 'ws_1', slug: 'acme', deletedAt: null },
      group: null,
    });
    const r = await redeemLinkCode({ code: 'ABCDEFGH', userId: 'u_1' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('not-found');
  });

  test('soft-deleted workspace → not-found', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      slug: 'api',
      deletedAt: null,
      workspaceId: 'ws_1',
      workspace: { id: 'ws_1', slug: 'acme', deletedAt: new Date() },
      group: null,
    });
    const r = await redeemLinkCode({ code: 'ABCDEFGH', userId: 'u_1' });
    expect(r.ok).toBe(false);
  });

  test('caller is not a workspace member → not-a-member (actionable message)', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      slug: 'api',
      deletedAt: null,
      workspaceId: 'ws_1',
      workspace: { id: 'ws_1', slug: 'acme', deletedAt: null },
      group: null,
    });
    fakePrisma.workspaceMember.findUnique.mockResolvedValueOnce(null);
    const r = await redeemLinkCode({ code: 'ABCDEFGH', userId: 'u_outsider' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('not-a-member');
  });

  test('member → ok with workspace + project + group (null if no group)', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      slug: 'api',
      deletedAt: null,
      workspaceId: 'ws_1',
      workspace: { id: 'ws_1', slug: 'acme', deletedAt: null },
      group: null,
    });
    fakePrisma.workspaceMember.findUnique.mockResolvedValueOnce({ id: 'mem_1' });
    const r = await redeemLinkCode({ code: 'ABCDEFGH', userId: 'u_1' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r).toEqual({
      ok: true,
      workspace: { slug: 'acme' },
      project: { slug: 'api', group: null },
    });
  });

  test('soft-deleted group attached → group flattened to null', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      slug: 'api',
      deletedAt: null,
      workspaceId: 'ws_1',
      workspace: { id: 'ws_1', slug: 'acme', deletedAt: null },
      group: { slug: 'backend', name: 'Backend', deletedAt: new Date() },
    });
    fakePrisma.workspaceMember.findUnique.mockResolvedValueOnce({ id: 'mem_1' });
    const r = await redeemLinkCode({ code: 'ABCDEFGH', userId: 'u_1' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.project.group).toBeNull();
  });

  test('formatted code with hyphen + lowercase is normalized before lookup', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    await redeemLinkCode({ code: 'abcd-efgh', userId: 'u_1' });
    const args = fakePrisma.project.findUnique.mock.calls[0]?.[0] as {
      where: { linkCode: string };
    };
    expect(args.where.linkCode).toBe('ABCDEFGH');
  });
});
