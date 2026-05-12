// Tests for pruneEnvironmentHistory — the inline version-history sweep.
//
// Invariants we defend:
//   1. Under or at cap → no DB write, no R2 call (steady-state path).
//   2. Over cap → only the over-cap rows are deleted; cap rows stay.
//   3. The current pointer is NEVER deleted, even if it's "older" than
//      the cap (post-rollback to an ancient version).
//   4. R2 deletion happens BEFORE the DB row delete. R2 failure surfaces
//      as a throw and leaves DB rows intact (next push retries).
//   5. R2-not-configured → DB cleanup still proceeds, r2Skipped flag set.
//   6. Limit <= 0 → no-op (degenerate input guard).

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { FakeR2NotConfigured, makeR2Mock } from '@/test/r2-mock';

const fakePrisma = {
  environment: { findUnique: mock() },
  envFileVersion: { findMany: mock(), findUnique: mock(), deleteMany: mock() },
};

const fakeDeleteObjects = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('./r2', () => makeR2Mock({ deleteObjects: fakeDeleteObjects }));
mock.module('@/lib/r2', () => makeR2Mock({ deleteObjects: fakeDeleteObjects }));

const { pruneEnvironmentHistory } = await import('./version-sweep');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeDeleteObjects.mockReset();
  fakeDeleteObjects.mockResolvedValue(undefined);
  fakePrisma.envFileVersion.deleteMany.mockResolvedValue({ count: 0 });
});

function makeVersionRow(version: number) {
  return {
    id: `ver_${version}`,
    r2Key: `workspaces/ws/projects/p/environments/e/versions/v${version}`,
  };
}

describe('pruneEnvironmentHistory — degenerate inputs', () => {
  test('limit = 0 → no DB or R2 calls', async () => {
    const result = await pruneEnvironmentHistory('env_1', 0);
    expect(result).toEqual({ prunedVersions: 0, prunedR2Objects: 0, r2Skipped: false });
    expect(fakePrisma.environment.findUnique).not.toHaveBeenCalled();
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
  });

  test('negative limit → no DB or R2 calls', async () => {
    const result = await pruneEnvironmentHistory('env_1', -10);
    expect(result.prunedVersions).toBe(0);
    expect(fakePrisma.environment.findUnique).not.toHaveBeenCalled();
  });

  test('non-integer limit → no DB or R2 calls', async () => {
    const result = await pruneEnvironmentHistory('env_1', 12.7);
    expect(result.prunedVersions).toBe(0);
    expect(fakePrisma.environment.findUnique).not.toHaveBeenCalled();
  });

  test('missing environment → no-op', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce(null);
    const result = await pruneEnvironmentHistory('env_ghost', 50);
    expect(result.prunedVersions).toBe(0);
    expect(fakePrisma.envFileVersion.findMany).not.toHaveBeenCalled();
  });
});

describe('pruneEnvironmentHistory — under / at cap (steady state)', () => {
  test('zero versions retained → no delete', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: null });
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce([]);
    const result = await pruneEnvironmentHistory('env_1', 50);
    expect(result.prunedVersions).toBe(0);
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
    expect(fakePrisma.envFileVersion.deleteMany).not.toHaveBeenCalled();
  });

  test('exactly cap → no delete', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_50' });
    const rows = Array.from({ length: 50 }, (_, i) => makeVersionRow(50 - i)); // 50..1 desc
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce(rows);
    const result = await pruneEnvironmentHistory('env_1', 50);
    expect(result.prunedVersions).toBe(0);
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
    expect(fakePrisma.envFileVersion.deleteMany).not.toHaveBeenCalled();
  });

  test('one under cap → no delete (take=limit+1 distinguishes)', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_49' });
    const rows = Array.from({ length: 49 }, (_, i) => makeVersionRow(49 - i));
    fakePrisma.envFileVersion.findMany.mockResolvedValueOnce(rows);
    const result = await pruneEnvironmentHistory('env_1', 50);
    expect(result.prunedVersions).toBe(0);
  });
});

describe('pruneEnvironmentHistory — over cap', () => {
  test('one over cap → exactly one row pruned', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_10' });
    // take=limit+1=4. Cap=3, so newest 3 stay (v10, v9, v8), v7 is the
    // candidate. Newer-than-cap is preserved.
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakePrisma.envFileVersion.findMany
      // First call: the take=limit+1 probe.
      .mockResolvedValueOnce(recent)
      // Second call: the candidate scan (everything older than the oldest kept).
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });
    fakePrisma.envFileVersion.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await pruneEnvironmentHistory('env_1', 3);

    expect(result).toEqual({ prunedVersions: 1, prunedR2Objects: 1, r2Skipped: false });
    expect(fakeDeleteObjects).toHaveBeenCalledTimes(1);
    expect(fakeDeleteObjects.mock.calls[0]?.[0]).toEqual([
      'workspaces/ws/projects/p/environments/e/versions/v7',
    ]);
    expect(fakePrisma.envFileVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ver_7'] } },
    });
  });

  test('many over cap → all over-cap rows pruned in one batch', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_100' });
    // Cap=3, so v100, v99, v98 are kept. v97..v1 are candidates (97 rows).
    const recent = Array.from({ length: 4 }, (_, i) => makeVersionRow(100 - i));
    const candidates = Array.from({ length: 97 }, (_, i) => makeVersionRow(97 - i));
    fakePrisma.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(candidates);
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 98 });

    const result = await pruneEnvironmentHistory('env_1', 3);

    expect(result.prunedVersions).toBe(97);
    expect(result.prunedR2Objects).toBe(97);
    expect(fakeDeleteObjects).toHaveBeenCalledTimes(1);
    expect((fakeDeleteObjects.mock.calls[0]?.[0] as string[]).length).toBe(97);
  });
});

describe('pruneEnvironmentHistory — current pointer protection', () => {
  test('current pointer beyond cap is preserved (never pruned)', async () => {
    // The user rolled back to v3 with a long history above it. Current
    // pointer = v3, cap = 3, history = v3..v100. Newest 3 (v100, v99,
    // v98) stay; the rest are candidates EXCEPT v3 which must survive.
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_3' });
    const recent = Array.from({ length: 4 }, (_, i) => makeVersionRow(100 - i));
    fakePrisma.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(
        // Server side returned everything older than v98 EXCEPT v3.
        Array.from({ length: 94 }, (_, i) => makeVersionRow(97 - i)),
      );
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 98 });

    await pruneEnvironmentHistory('env_1', 3);

    // The candidate findMany must have been scoped with `id: { not: 'ver_3' }`.
    const where = fakePrisma.envFileVersion.findMany.mock.calls[1]?.[0]?.where as {
      environmentId: string;
      version: { lt: number };
      id: { not: string };
    };
    expect(where).toBeDefined();
    expect(where.id).toEqual({ not: 'ver_3' });
    expect(where.version).toEqual({ lt: 98 });
  });

  test('no current pointer (env never finalized) → no id-guard filter', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: null });
    const recent = Array.from({ length: 4 }, (_, i) => makeVersionRow(100 - i));
    fakePrisma.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(Array.from({ length: 97 }, (_, i) => makeVersionRow(97 - i)));
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 98 });

    await pruneEnvironmentHistory('env_1', 3);

    const where = fakePrisma.envFileVersion.findMany.mock.calls[1]?.[0]?.where as {
      environmentId: string;
      id?: unknown;
    };
    expect(where.id).toBeUndefined();
  });
});

describe('pruneEnvironmentHistory — R2 failure handling', () => {
  test('R2 throws non-config error → propagates, DB rows untouched', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_10' });
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakePrisma.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });
    fakeDeleteObjects.mockRejectedValueOnce(new Error('R2 transient error'));

    await expect(pruneEnvironmentHistory('env_1', 3)).rejects.toThrow(/R2 transient error/);

    // DB delete must NOT have fired on R2 failure.
    expect(fakePrisma.envFileVersion.deleteMany).not.toHaveBeenCalled();
  });

  test('R2-not-configured → DB rows still deleted, r2Skipped: true', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_10' });
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakePrisma.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });
    fakeDeleteObjects.mockRejectedValueOnce(new FakeR2NotConfigured());

    const result = await pruneEnvironmentHistory('env_1', 3);

    expect(result.prunedVersions).toBe(1);
    expect(result.prunedR2Objects).toBe(0);
    expect(result.r2Skipped).toBe(true);
    expect(fakePrisma.envFileVersion.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('pruneEnvironmentHistory — ordering invariant', () => {
  test('R2 delete is called BEFORE DB deleteMany (retry-safe)', async () => {
    fakePrisma.environment.findUnique.mockResolvedValueOnce({ currentVersionId: 'ver_10' });
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakePrisma.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakePrisma.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });

    const order: string[] = [];
    fakeDeleteObjects.mockImplementationOnce(async () => {
      order.push('r2');
    });
    fakePrisma.envFileVersion.deleteMany.mockImplementationOnce(async () => {
      order.push('db');
      return { count: 1 };
    });

    await pruneEnvironmentHistory('env_1', 3);

    expect(order).toEqual(['r2', 'db']);
  });
});
