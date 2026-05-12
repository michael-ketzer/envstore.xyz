// Tests for project group helpers: create, resolve-or-create, update,
// soft-delete. The soft-delete is transactional (unassign children, then
// tombstone the group) — we pin that the two writes happen together.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  projectGroup: { findUnique: mock(), create: mock(), update: mock() },
  project: { updateMany: mock() },
  $transaction: mock(),
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));

const {
  createProjectGroup,
  resolveOrCreateProjectGroupId,
  updateProjectGroup,
  softDeleteProjectGroup,
} = await import('./project-groups');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    if (typeof m === 'function') continue;
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.$transaction.mockReset();
  fakePrisma.$transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe('createProjectGroup', () => {
  test('explicit slug + free → ok', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce(null);
    fakePrisma.projectGroup.create.mockResolvedValueOnce({ id: 'grp_new', slug: 'backend' });
    const r = await createProjectGroup('ws_1', { name: 'Backend', slug: 'backend' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.group.id).toBe('grp_new');
  });

  test('invalid slug → invalid-slug (no create)', async () => {
    const r = await createProjectGroup('ws_1', { name: 'B', slug: 'NoCapsAllowed' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('invalid-slug');
    expect(fakePrisma.projectGroup.create).not.toHaveBeenCalled();
  });

  test('slug occupied by live group → slug-taken', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_existing',
      deletedAt: null,
    });
    const r = await createProjectGroup('ws_1', { name: 'B', slug: 'backend' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('slug-taken');
    expect(r.message).toMatch(/already exists/);
  });

  test('slug held by soft-deleted group → slug-taken with tombstone hint', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_dead',
      deletedAt: new Date(),
    });
    const r = await createProjectGroup('ws_1', { name: 'B', slug: 'backend' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.message).toMatch(/deleted group still holds/i);
  });

  test('no slug supplied → auto-generated <slugified-name>-<hex>', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce(null);
    fakePrisma.projectGroup.create.mockResolvedValueOnce({ id: 'grp_new', slug: 'back-end-abcd' });
    const r = await createProjectGroup('ws_1', { name: 'Back End' });
    expect(r.ok).toBe(true);
    const createArgs = fakePrisma.projectGroup.create.mock.calls[0]?.[0] as {
      data: { slug: string };
    };
    expect(createArgs.data.slug).toMatch(/^back-end-[0-9a-f]{4}$/);
  });
});

describe('resolveOrCreateProjectGroupId', () => {
  test('live group exists → returns its id (no create)', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_live',
      deletedAt: null,
    });
    const id = await resolveOrCreateProjectGroupId('ws_1', 'backend');
    expect(id).toBe('grp_live');
    expect(fakePrisma.projectGroup.create).not.toHaveBeenCalled();
    expect(fakePrisma.projectGroup.update).not.toHaveBeenCalled();
  });

  test('soft-deleted group → resurrected (deletedAt cleared, id returned)', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_dead',
      deletedAt: new Date(),
    });
    fakePrisma.projectGroup.update.mockResolvedValueOnce({});
    const id = await resolveOrCreateProjectGroupId('ws_1', 'backend');
    expect(id).toBe('grp_dead');
    const args = fakePrisma.projectGroup.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { deletedAt: null };
    };
    expect(args.data.deletedAt).toBeNull();
  });

  test('no group → creates one named after the slug', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce(null);
    fakePrisma.projectGroup.create.mockResolvedValueOnce({ id: 'grp_new' });
    const id = await resolveOrCreateProjectGroupId('ws_1', 'fresh');
    expect(id).toBe('grp_new');
    const args = fakePrisma.projectGroup.create.mock.calls[0]?.[0] as {
      data: { workspaceId: string; slug: string; name: string };
    };
    expect(args.data).toEqual({ workspaceId: 'ws_1', slug: 'fresh', name: 'fresh' });
  });

  test('invalid slug → null (no DB writes)', async () => {
    const id = await resolveOrCreateProjectGroupId('ws_1', 'CAPS!');
    expect(id).toBeNull();
    expect(fakePrisma.projectGroup.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.projectGroup.create).not.toHaveBeenCalled();
  });
});

describe('updateProjectGroup', () => {
  test('unknown / soft-deleted → not-found, no update', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_dead',
      deletedAt: new Date(),
    });
    const r = await updateProjectGroup('ws_1', 'backend', { name: 'New' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('not-found');
    expect(fakePrisma.projectGroup.update).not.toHaveBeenCalled();
  });

  test('happy path → patches name + description', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_1',
      deletedAt: null,
    });
    fakePrisma.projectGroup.update.mockResolvedValueOnce({});
    const r = await updateProjectGroup('ws_1', 'backend', { name: 'New name', description: 'desc' });
    expect(r.ok).toBe(true);
    const args = fakePrisma.projectGroup.update.mock.calls[0]?.[0] as {
      data: { name: string; description: string };
    };
    expect(args.data).toEqual({ name: 'New name', description: 'desc' });
  });
});

describe('softDeleteProjectGroup', () => {
  test('unknown / soft-deleted → not-found, no transaction', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce(null);
    const r = await softDeleteProjectGroup('ws_1', 'ghost');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(fakePrisma.$transaction).not.toHaveBeenCalled();
  });

  test('happy path → atomic unassign-children + tombstone, in a single $transaction', async () => {
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_1',
      deletedAt: null,
    });
    // The transaction returns whatever array of operations was passed in;
    // the helper itself doesn't care about the return value.
    const r = await softDeleteProjectGroup('ws_1', 'backend');
    expect(r.ok).toBe(true);

    // Critical: both writes must be inside the SAME $transaction call so a
    // partial state (group gone but its projects still claim its id) is
    // impossible.
    expect(fakePrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = fakePrisma.$transaction.mock.calls[0]?.[0] as unknown[];
    expect(ops).toHaveLength(2);
  });
});
