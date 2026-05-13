// Tests for workspace creation + the idempotent personal-workspace
// bootstrapping called on signup.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  user: { findUnique: mock() },
  workspace: { findUnique: mock(), findFirst: mock(), create: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const { createTeamWorkspace, ensurePersonalWorkspace } = await import('./workspaces');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
});

describe('createTeamWorkspace', () => {
  test('slug already in use → ok:false slug-taken (no create)', async () => {
    fakePrisma.workspace.findUnique.mockResolvedValueOnce({ id: 'ws_existing' });
    const r = await createTeamWorkspace('u_1', { name: 'Acme', slug: 'acme' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('slug-taken');
    expect(fakePrisma.workspace.create).not.toHaveBeenCalled();
  });

  test('reserved slug → ok:false invalid-slug', async () => {
    const r = await createTeamWorkspace('u_1', { name: 'Admin', slug: 'admin' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('invalid-slug');
    expect(fakePrisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.workspace.create).not.toHaveBeenCalled();
  });

  test('happy path → creates workspace as TEAM with trial subscription + owner member', async () => {
    fakePrisma.workspace.findUnique.mockResolvedValueOnce(null);
    fakePrisma.workspace.create.mockResolvedValueOnce({ id: 'ws_new', slug: 'acme' });

    const r = await createTeamWorkspace('u_1', { name: 'Acme', slug: 'acme' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.workspace).toEqual({ id: 'ws_new', slug: 'acme' });

    const createArgs = fakePrisma.workspace.create.mock.calls[0]?.[0] as {
      data: {
        type: string;
        ownerId: string;
        slug: string;
        members: { create: { userId: string; role: string } };
        subscription: { create: { status: string; trialEndsAt: Date } };
      };
    };
    expect(createArgs.data.type).toBe('TEAM');
    expect(createArgs.data.ownerId).toBe('u_1');
    expect(createArgs.data.members.create.role).toBe('OWNER');
    expect(createArgs.data.subscription.create.status).toBe('TRIALING');
    expect(createArgs.data.subscription.create.trialEndsAt).toBeInstanceOf(Date);
  });
});

describe('ensurePersonalWorkspace', () => {
  test('idempotent: existing personal workspace → no-op', async () => {
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_1',
      email: 'alice@example.com',
      name: 'Alice',
    });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_existing' });

    await ensurePersonalWorkspace('u_1');
    expect(fakePrisma.workspace.create).not.toHaveBeenCalled();
  });

  test('first call for a user → creates PERSONAL workspace with opaque slug + trial subscription', async () => {
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_1',
      email: 'alice@example.com',
      name: 'Alice',
    });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    fakePrisma.workspace.findUnique.mockResolvedValueOnce(null); // slug pick: not taken
    fakePrisma.workspace.create.mockResolvedValueOnce({ id: 'ws_new' });

    await ensurePersonalWorkspace('u_1');
    expect(fakePrisma.workspace.create).toHaveBeenCalledTimes(1);
    const createArgs = fakePrisma.workspace.create.mock.calls[0]?.[0] as {
      data: { type: string; ownerId: string; slug: string; name: string };
    };
    expect(createArgs.data.type).toBe('PERSONAL');
    expect(createArgs.data.ownerId).toBe('u_1');
    // L5 fix: slug is now an opaque `personal-<6 hex>`, never derived from
    // the user's email local-part. The previous behavior leaked the email
    // address as a URL segment and into audit-log rows that reference the
    // workspace by slug.
    expect(createArgs.data.slug).toMatch(/^personal-[0-9a-f]{6}$/);
    expect(createArgs.data.slug).not.toContain('alice');
    expect(createArgs.data.name).toBe('Alice');
  });

  test('slug collision → falls back to a suffixed candidate (slug stays opaque)', async () => {
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_2',
      email: 'alice@example.com',
      name: null,
    });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    fakePrisma.workspace.findUnique
      .mockResolvedValueOnce({ id: 'ws_first' }) // first candidate taken
      .mockResolvedValueOnce(null); // suffix candidate is free
    fakePrisma.workspace.create.mockResolvedValueOnce({ id: 'ws_new' });

    await ensurePersonalWorkspace('u_2');
    const createArgs = fakePrisma.workspace.create.mock.calls[0]?.[0] as {
      data: { slug: string; name: string };
    };
    // Doubly suffixed: `personal-<6 hex>-<6 hex>` once the first random
    // candidate also clashes (vanishingly unlikely in practice, but the
    // fallback path must still produce a valid opaque slug).
    expect(createArgs.data.slug).toMatch(/^personal-[0-9a-f]{6}-[0-9a-f]{6}$/);
    expect(createArgs.data.slug).not.toContain('alice');
    // Name falls back to "Personal" when user.name is null.
    expect(createArgs.data.name).toBe('Personal');
  });

  test('unknown userId → throws (no workspace created)', async () => {
    fakePrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(ensurePersonalWorkspace('u_ghost')).rejects.toThrow(/not found/);
    expect(fakePrisma.workspace.create).not.toHaveBeenCalled();
  });

  test('email is never leaked into the slug, regardless of local-part', async () => {
    // L5 regression: the prior code did `user.email.split('@')[0]` for the
    // base slug, so an email like `legal@…` produced `/dashboard/legal`.
    // Now the slug is opaque random — the email never appears in it.
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_legal',
      email: 'legal@example.com',
      name: null,
    });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    fakePrisma.workspace.findUnique.mockResolvedValueOnce(null);
    fakePrisma.workspace.create.mockResolvedValueOnce({ id: 'ws_new' });

    await ensurePersonalWorkspace('u_legal');
    const createArgs = fakePrisma.workspace.create.mock.calls[0]?.[0] as {
      data: { slug: string };
    };
    expect(createArgs.data.slug).not.toContain('legal');
    expect(createArgs.data.slug).toMatch(/^personal-[0-9a-f]{6}$/);
  });
});
