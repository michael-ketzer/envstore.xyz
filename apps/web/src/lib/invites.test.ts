// Tests for workspace invite creation + acceptance.
//
// Three security-relevant invariants:
//   1. The plaintext token is in the response and email-out, never in DB.
//   2. Acceptance requires the redeeming user's email to match the invite's
//      target email — otherwise an attacker who steals an invite URL could
//      join the workspace as themselves.
//   3. Expired / already-accepted invites can't be redeemed twice.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';

import { makeDbMock } from '@/test/db-mock';
import { makeEmailMock } from '@/test/email-mock';
import { makeEnvMock } from '@/test/env-mock';

const fakePrisma = {
  workspaceMember: { findFirst: mock(), findUnique: mock(), create: mock() },
  invite: { findFirst: mock(), findUnique: mock(), create: mock(), update: mock() },
};

const fakeSendInviteEmail = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/env', () => makeEnvMock({ env: { AUTH_URL: 'https://envstore.xyz' } }));
mock.module('./email', () => makeEmailMock({ sendInviteEmail: fakeSendInviteEmail }));

const { createInvite, acceptInviteByToken, generateInviteToken } = await import('./invites');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeSendInviteEmail.mockReset();
  fakeSendInviteEmail.mockResolvedValue(undefined);
  fakePrisma.workspaceMember.findFirst.mockResolvedValue(null);
  fakePrisma.invite.findFirst.mockResolvedValue(null);
});

describe('generateInviteToken', () => {
  test('returns URL-safe base64 (no padding), distinct per call', () => {
    const t1 = generateInviteToken();
    const t2 = generateInviteToken();
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t1).not.toBe(t2);
  });
});

describe('createInvite', () => {
  const baseArgs = {
    workspaceId: 'ws_1',
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    invitedByUserId: 'u_owner',
    inviterName: 'Owner',
    email: 'invitee@example.com',
    role: 'MEMBER' as const,
  };

  test('happy path → DB stores only the hash, email gets the plaintext', async () => {
    fakePrisma.invite.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'inv_new',
      email: args.data.email as string,
    }));

    const r = await createInvite(baseArgs);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');

    const createArgs = fakePrisma.invite.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string; email: string };
    };
    // tokenHash must be a sha256 hex (64 chars), never the plaintext.
    expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createArgs.data.email).toBe('invitee@example.com');

    // Email must include the plaintext token in the accept URL.
    expect(fakeSendInviteEmail).toHaveBeenCalledTimes(1);
    const emailCall = fakeSendInviteEmail.mock.calls[0]?.[0] as { acceptUrl: string };
    expect(emailCall.acceptUrl).toContain('https://envstore.xyz/invite/');
    // sha256(plaintext) must match what we persisted.
    const plaintext = emailCall.acceptUrl.split('/invite/')[1]!;
    expect(await sha256Hex(plaintext)).toBe(createArgs.data.tokenHash);
  });

  test('email normalization: lowercased + trimmed before DB lookup', async () => {
    fakePrisma.invite.create.mockResolvedValueOnce({ id: 'inv', email: 'a@b.c' });
    await createInvite({ ...baseArgs, email: '  Mixed@Example.COM  ' });
    const memberCheck = fakePrisma.workspaceMember.findFirst.mock.calls[0]?.[0] as {
      where: { user: { email: string } };
    };
    expect(memberCheck.where.user.email).toBe('mixed@example.com');
  });

  test('caller is already a member → already-member, no invite row created', async () => {
    fakePrisma.workspaceMember.findFirst.mockResolvedValueOnce({ id: 'mem_1' });
    const r = await createInvite(baseArgs);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('already-member');
    expect(fakePrisma.invite.create).not.toHaveBeenCalled();
    expect(fakeSendInviteEmail).not.toHaveBeenCalled();
  });

  test('pending invite exists → pending-exists (idempotency at the user-facing layer)', async () => {
    fakePrisma.invite.findFirst.mockResolvedValueOnce({ id: 'inv_existing' });
    const r = await createInvite(baseArgs);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('pending-exists');
    expect(fakePrisma.invite.create).not.toHaveBeenCalled();
  });

  test('expiry is roughly inviteExpiryDays out', async () => {
    fakePrisma.invite.create.mockResolvedValueOnce({ id: 'inv', email: 'invitee@example.com' });
    const before = Date.now();
    await createInvite(baseArgs);
    const createArgs = fakePrisma.invite.create.mock.calls[0]?.[0] as {
      data: { expiresAt: Date };
    };
    const sevenDays = before + 7 * 24 * 60 * 60 * 1000;
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(sevenDays - 10_000);
    expect(createArgs.data.expiresAt.getTime()).toBeLessThan(sevenDays + 10_000);
  });
});

describe('acceptInviteByToken', () => {
  const baseArgs = {
    token: 'plaintext-invite-token',
    userId: 'u_invitee',
    userEmail: 'invitee@example.com',
  };

  async function stageInvite(opts: {
    email?: string;
    acceptedAt?: Date | null;
    expiresAt?: Date;
  } = {}) {
    const tokenHash = await sha256Hex(baseArgs.token);
    fakePrisma.invite.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
      if (args.where.tokenHash !== tokenHash) return null;
      return {
        id: 'inv_1',
        workspaceId: 'ws_1',
        email: opts.email ?? 'invitee@example.com',
        role: 'MEMBER' as const,
        tokenHash,
        invitedByUserId: 'u_owner',
        acceptedAt: opts.acceptedAt ?? null,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000),
        workspace: { id: 'ws_1', slug: 'acme' },
      };
    });
  }

  test('unknown token → not-found (no info leak)', async () => {
    fakePrisma.invite.findUnique.mockResolvedValueOnce(null);
    const r = await acceptInviteByToken(baseArgs);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('not-found');
  });

  test('already accepted → accepted (idempotency: not silently re-accept)', async () => {
    await stageInvite({ acceptedAt: new Date('2026-01-01') });
    const r = await acceptInviteByToken(baseArgs);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('accepted');
    expect(fakePrisma.workspaceMember.create).not.toHaveBeenCalled();
  });

  test('expired → expired', async () => {
    await stageInvite({ expiresAt: new Date(Date.now() - 60_000) });
    const r = await acceptInviteByToken(baseArgs);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('expired');
    expect(fakePrisma.workspaceMember.create).not.toHaveBeenCalled();
  });

  test('email-mismatch: invite for X, caller is Y → email-mismatch (security gate)', async () => {
    await stageInvite({ email: 'someone-else@example.com' });
    const r = await acceptInviteByToken(baseArgs);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('email-mismatch');
    // The error message reveals the target email — fine, that's what was
    // in the URL anyway, and it's information the caller can already see.
    expect(r.message).toContain('someone-else@example.com');
    expect(fakePrisma.workspaceMember.create).not.toHaveBeenCalled();
  });

  test('case-insensitive email match (Mixed@Example.com vs mixed@example.com → accepted)', async () => {
    await stageInvite({ email: 'Mixed@Example.com' });
    fakePrisma.workspaceMember.findUnique.mockResolvedValueOnce(null);
    fakePrisma.workspaceMember.create.mockResolvedValueOnce({ id: 'mem_new' });
    fakePrisma.invite.update.mockResolvedValueOnce({});

    const r = await acceptInviteByToken({
      ...baseArgs,
      userEmail: 'mixed@example.com',
    });
    expect(r.ok).toBe(true);
  });

  test('happy path → creates member, marks invite acceptedAt', async () => {
    await stageInvite();
    fakePrisma.workspaceMember.findUnique.mockResolvedValueOnce(null);
    fakePrisma.workspaceMember.create.mockResolvedValueOnce({ id: 'mem_new' });
    fakePrisma.invite.update.mockResolvedValueOnce({});

    const r = await acceptInviteByToken(baseArgs);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.workspaceSlug).toBe('acme');

    const createArgs = fakePrisma.workspaceMember.create.mock.calls[0]?.[0] as {
      data: { workspaceId: string; userId: string; role: string };
    };
    expect(createArgs.data).toEqual({
      workspaceId: 'ws_1',
      userId: 'u_invitee',
      role: 'MEMBER',
    });

    // The invite must be marked accepted so a re-attempt is rejected.
    const updateArgs = fakePrisma.invite.update.mock.calls[0]?.[0] as {
      data: { acceptedAt: Date };
    };
    expect(updateArgs.data.acceptedAt).toBeInstanceOf(Date);
  });

  test('already a member somehow → skip member.create, still mark accepted', async () => {
    await stageInvite();
    fakePrisma.workspaceMember.findUnique.mockResolvedValueOnce({ id: 'mem_existing' });
    fakePrisma.invite.update.mockResolvedValueOnce({});

    const r = await acceptInviteByToken(baseArgs);
    expect(r.ok).toBe(true);
    expect(fakePrisma.workspaceMember.create).not.toHaveBeenCalled();
    expect(fakePrisma.invite.update).toHaveBeenCalledTimes(1);
  });
});
