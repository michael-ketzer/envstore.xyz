// Tests for the retention sweep — the only piece of the system that hard-
// deletes user data.
//
// The two invariants we defend explicitly:
//   1. R2 objects are deleted BEFORE the matching DB rows. If R2 fails, we
//      surface the failure (or set r2Skipped) without orphaning data: a
//      retry sees the same DB rows and tries R2 again.
//   2. Retention boundary is strict — `deletedAt + retentionDays < now`
//      means delete; not-yet-expired stays alone.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { FakeR2NotConfigured, makeR2Mock } from '@/test/r2-mock';

const fakePrisma = {
  workspace: { findMany: mock(), delete: mock() },
  project: { findMany: mock(), delete: mock() },
  environment: { findMany: mock(), delete: mock() },
  projectGroup: { findMany: mock(), delete: mock() },
  envFileVersion: { findMany: mock() },
  auditLog: { create: mock() },
};

const fakeDeleteObjects = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('./r2', () => makeR2Mock({ deleteObjects: fakeDeleteObjects }));
mock.module('@/lib/r2', () => makeR2Mock({ deleteObjects: fakeDeleteObjects }));

const { runRetentionSweep } = await import('./retention-sweep');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeDeleteObjects.mockReset();
  fakePrisma.workspace.findMany.mockResolvedValue([]);
  fakePrisma.project.findMany.mockResolvedValue([]);
  fakePrisma.environment.findMany.mockResolvedValue([]);
  fakePrisma.projectGroup.findMany.mockResolvedValue([]);
  fakePrisma.envFileVersion.findMany.mockResolvedValue([]);
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakePrisma.workspace.delete.mockResolvedValue({});
  fakePrisma.project.delete.mockResolvedValue({});
  fakePrisma.environment.delete.mockResolvedValue({});
  fakePrisma.projectGroup.delete.mockResolvedValue({});
  fakeDeleteObjects.mockResolvedValue(undefined);
});

const FORTY_DAYS_AGO = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
const TEN_DAYS_AGO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

describe('runRetentionSweep — retention boundary', () => {
  test('workspace past retention is hard-deleted; not-yet-expired stays', async () => {
    fakePrisma.workspace.findMany.mockResolvedValueOnce([
      { id: 'ws_old', slug: 'old', deletedAt: FORTY_DAYS_AGO, softDeleteRetentionDays: 30 },
      { id: 'ws_fresh', slug: 'fresh', deletedAt: TEN_DAYS_AGO, softDeleteRetentionDays: 30 },
    ]);
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([{ r2Key: 'k1' }, { r2Key: 'k2' }]);

    const result = await runRetentionSweep();
    expect(result.workspaces).toBe(1);
    expect(result.versions).toBe(2);
    expect(fakePrisma.workspace.delete).toHaveBeenCalledTimes(1);
    const args = fakePrisma.workspace.delete.mock.calls[0]?.[0] as { where: { id: string } };
    expect(args.where.id).toBe('ws_old');
  });

  test('exactly at boundary (now == deletedAt + retention) does NOT delete (strict <)', async () => {
    const now = Date.now();
    const exactlyAtBoundary = new Date(now - 30 * 24 * 60 * 60 * 1000);
    fakePrisma.workspace.findMany.mockResolvedValueOnce([
      {
        id: 'ws_boundary',
        slug: 'b',
        deletedAt: exactlyAtBoundary,
        softDeleteRetentionDays: 30,
      },
    ]);
    const result = await runRetentionSweep();
    expect(result.workspaces).toBe(0);
    expect(fakePrisma.workspace.delete).not.toHaveBeenCalled();
  });

  test('respects per-workspace retentionDays (custom 7-day retention)', async () => {
    fakePrisma.workspace.findMany.mockResolvedValueOnce([
      // 10 days deleted, 7-day retention → delete
      { id: 'ws_a', slug: 'a', deletedAt: TEN_DAYS_AGO, softDeleteRetentionDays: 7 },
      // 10 days deleted, 30-day retention → keep
      { id: 'ws_b', slug: 'b', deletedAt: TEN_DAYS_AGO, softDeleteRetentionDays: 30 },
    ]);
    const result = await runRetentionSweep();
    expect(result.workspaces).toBe(1);
    const deleted = fakePrisma.workspace.delete.mock.calls[0]?.[0] as { where: { id: string } };
    expect(deleted.where.id).toBe('ws_a');
  });
});

describe('runRetentionSweep — R2 ordering', () => {
  test('R2 objects deleted BEFORE the DB row (retry-safe)', async () => {
    fakePrisma.workspace.findMany.mockResolvedValueOnce([
      { id: 'ws_old', slug: 'old', deletedAt: FORTY_DAYS_AGO, softDeleteRetentionDays: 30 },
    ]);
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([{ r2Key: 'k1' }]);

    const callOrder: string[] = [];
    fakeDeleteObjects.mockImplementationOnce(async () => {
      callOrder.push('r2');
    });
    fakePrisma.workspace.delete.mockImplementationOnce(async () => {
      callOrder.push('db');
      return {};
    });

    await runRetentionSweep();
    expect(callOrder).toEqual(['r2', 'db']);
  });

  test('R2 failure surfaces as throw — DB row stays so the next run retries', async () => {
    fakePrisma.workspace.findMany.mockResolvedValueOnce([
      { id: 'ws_old', slug: 'old', deletedAt: FORTY_DAYS_AGO, softDeleteRetentionDays: 30 },
    ]);
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([{ r2Key: 'k1' }]);
    fakeDeleteObjects.mockRejectedValueOnce(new Error('r2 transient failure'));

    await expect(runRetentionSweep()).rejects.toThrow('r2 transient failure');
    // The workspace DB row was NOT deleted — we'll retry the whole pair
    // (R2 + DB) on the next sweep.
    expect(fakePrisma.workspace.delete).not.toHaveBeenCalled();
  });

  test('R2 not configured → r2Skipped flag set, DB cleanup proceeds', async () => {
    fakePrisma.workspace.findMany.mockResolvedValueOnce([
      { id: 'ws_old', slug: 'old', deletedAt: FORTY_DAYS_AGO, softDeleteRetentionDays: 30 },
    ]);
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([{ r2Key: 'k1' }]);
    fakeDeleteObjects.mockRejectedValueOnce(new FakeR2NotConfigured());

    const result = await runRetentionSweep();
    expect(result.r2Skipped).toBe(true);
    expect(result.workspaces).toBe(1);
    // DB row removed even though R2 wasn't configured — local-dev parity.
    expect(fakePrisma.workspace.delete).toHaveBeenCalledTimes(1);
  });
});

describe('runRetentionSweep — scope (projects, environments, groups)', () => {
  test('skips deleted environments whose workspace is itself deleted (workspace sweep owns it)', async () => {
    fakePrisma.environment.findMany.mockResolvedValueOnce([
      {
        id: 'env_under_dead_ws',
        slug: 'production',
        deletedAt: FORTY_DAYS_AGO,
        project: {
          workspaceId: 'ws_dead',
          workspace: { deletedAt: new Date(), softDeleteRetentionDays: 30 },
        },
      },
    ]);
    await runRetentionSweep();
    expect(fakePrisma.environment.delete).not.toHaveBeenCalled();
  });

  test('deletes expired projects under live workspaces (along with their R2 objects)', async () => {
    fakePrisma.project.findMany.mockResolvedValueOnce([
      {
        id: 'proj_dead',
        slug: 'old-api',
        deletedAt: FORTY_DAYS_AGO,
        workspaceId: 'ws_live',
        workspace: { softDeleteRetentionDays: 30 },
      },
    ]);
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([{ r2Key: 'pk1' }, { r2Key: 'pk2' }]);
    const result = await runRetentionSweep();
    expect(result.projects).toBe(1);
    expect(result.versions).toBe(2);
    expect(fakeDeleteObjects).toHaveBeenCalledWith(['pk1', 'pk2']);
  });

  test('deletes expired project groups (no R2 — groups own no versions)', async () => {
    fakePrisma.projectGroup.findMany.mockResolvedValueOnce([
      {
        id: 'grp_dead',
        slug: 'backend',
        deletedAt: FORTY_DAYS_AGO,
        workspaceId: 'ws_live',
        workspace: { softDeleteRetentionDays: 30 },
      },
    ]);
    const result = await runRetentionSweep();
    expect(result.groups).toBe(1);
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
  });

  test('idempotent: empty input → all zeros, no R2 call, no DB delete', async () => {
    const result = await runRetentionSweep();
    expect(result).toEqual({
      workspaces: 0,
      projects: 0,
      groups: 0,
      environments: 0,
      versions: 0,
      r2Skipped: false,
    });
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
    expect(fakePrisma.workspace.delete).not.toHaveBeenCalled();
  });
});
