// Tests for createProject — the slug/group resolution logic and the
// soft-delete tombstone collision case.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { makeProjectLinkCodesMock } from '@/test/project-link-codes-mock';

const fakePrisma = {
  project: { findUnique: mock(), create: mock() },
  projectGroup: { findUnique: mock(), update: mock(), create: mock() },
};

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
// Use the shared mock helper that presents the FULL project-link-codes
// export surface. A narrow mock here would be cached for the rest of the
// test run and break project-link-codes.test.ts (which imports the real
// module) and link-codes/redeem/route.test.ts.
mock.module('./project-link-codes', () =>
  makeProjectLinkCodesMock({
    pickUniqueLinkCode: async () => 'TESTCODE',
  }),
);

const { createProject } = await import('./projects');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePrisma.project.create.mockResolvedValue({ id: 'proj_new', slug: 'api' });
});

describe('createProject — explicit slug (CLI path)', () => {
  test('valid + free slug → ok, project created', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    const r = await createProject('ws_1', { name: 'API', slug: 'api' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(fakePrisma.project.create).toHaveBeenCalledTimes(1);
    const createArgs = fakePrisma.project.create.mock.calls[0]?.[0] as {
      data: { workspaceId: string; slug: string; linkCode: string };
    };
    expect(createArgs.data.workspaceId).toBe('ws_1');
    expect(createArgs.data.slug).toBe('api');
    expect(createArgs.data.linkCode).toBe('TESTCODE');
  });

  test('invalid slug → ok:false invalid-slug, no create', async () => {
    const r = await createProject('ws_1', { name: 'X', slug: 'Has Caps' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('invalid-slug');
    expect(fakePrisma.project.create).not.toHaveBeenCalled();
  });

  test('slug taken by live project → slug-taken with the "already exists" message', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      id: 'proj_existing',
      deletedAt: null,
    });
    const r = await createProject('ws_1', { name: 'API', slug: 'api' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('slug-taken');
    expect(r.message).toMatch(/already exists/);
  });

  test('slug taken by soft-deleted project → slug-taken with the tombstone hint', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      id: 'proj_old',
      deletedAt: new Date(),
    });
    const r = await createProject('ws_1', { name: 'API', slug: 'api' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected fail');
    expect(r.reason).toBe('slug-taken');
    // Message should hint that a deleted project still holds the slug,
    // so the user knows to either purge it or pick something else.
    expect(r.message).toMatch(/deleted project still holds/i);
  });
});

describe('createProject — auto-slug (web "new project" form)', () => {
  test('no slug → auto-generated <slugified-name>-<hex>', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    const r = await createProject('ws_1', { name: 'My Service' });
    expect(r.ok).toBe(true);
    const args = fakePrisma.project.create.mock.calls[0]?.[0] as {
      data: { slug: string };
    };
    expect(args.data.slug).toMatch(/^my-service-[0-9a-f]{4}$/);
  });

  test('empty name → falls back to "project-<hex>"', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    const r = await createProject('ws_1', { name: '' });
    expect(r.ok).toBe(true);
    const args = fakePrisma.project.create.mock.calls[0]?.[0] as {
      data: { slug: string };
    };
    expect(args.data.slug).toMatch(/^project-[0-9a-f]{4}$/);
  });
});

describe('createProject — group resolution', () => {
  test('group slug resolves to existing live group ID', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce({
      id: 'grp_existing',
      deletedAt: null,
    });

    await createProject('ws_1', { name: 'Service', slug: 'service', group: 'backend' });
    const args = fakePrisma.project.create.mock.calls[0]?.[0] as {
      data: { groupId: string | null };
    };
    expect(args.data.groupId).toBe('grp_existing');
  });

  test('group slug not in DB → group auto-created, project lands in it', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    fakePrisma.projectGroup.findUnique.mockResolvedValueOnce(null);
    fakePrisma.projectGroup.create.mockResolvedValueOnce({ id: 'grp_new' });

    await createProject('ws_1', { name: 'Service', slug: 'service', group: 'fresh' });
    const args = fakePrisma.project.create.mock.calls[0]?.[0] as {
      data: { groupId: string | null };
    };
    expect(args.data.groupId).toBe('grp_new');
  });

  test('no group → groupId null', async () => {
    fakePrisma.project.findUnique.mockResolvedValueOnce(null);
    await createProject('ws_1', { name: 'Service', slug: 'service' });
    const args = fakePrisma.project.create.mock.calls[0]?.[0] as {
      data: { groupId: string | null };
    };
    expect(args.data.groupId).toBeNull();
  });
});
