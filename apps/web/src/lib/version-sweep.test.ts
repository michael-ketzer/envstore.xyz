// Tests for pruneEnvironmentHistory — the inline version-history sweep.
//
// Invariants we defend:
//   1. Under or at cap → no DB write, no R2 call (steady-state path).
//   2. Over cap → only the over-cap rows are deleted; cap rows stay.
//   3. The current pointer is NEVER deleted, even if it's "older" than
//      the cap (post-rollback to an ancient version).
//   4. The current-pointer re-read AND the candidate delete happen
//      INSIDE one transaction. We lock the Environment row with
//      SELECT ... FOR UPDATE so a concurrent rollback can't flip the
//      pointer to a candidate between snapshot and delete.
//   5. R2 deletion runs AFTER the DB transaction commits. R2-not-
//      configured → DB cleanup still happened, r2Skipped flag set.
//      Other R2 errors propagate and leave orphan objects for the
//      retention-sweep cron to clean up later (worse case is a few
//      stale R2 objects, never DB rows pointing at deleted blobs).
//   6. Limit <= 0 / non-integer → no-op (degenerate input guard).

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { FakeR2NotConfigured, makeR2Mock } from '@/test/r2-mock';

// Tx-level mocks — these are what the transaction callback sees.
const fakeTx = {
  $queryRaw: mock(),
  envFileVersion: { findMany: mock(), findUnique: mock(), deleteMany: mock() },
};
const fakeTransaction = mock(async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx));

const fakePrisma = {
  $transaction: fakeTransaction,
};

const fakeDeleteObjects = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('./r2', () => makeR2Mock({ deleteObjects: fakeDeleteObjects }));
mock.module('@/lib/r2', () => makeR2Mock({ deleteObjects: fakeDeleteObjects }));

const { pruneEnvironmentHistory } = await import('./version-sweep');

beforeEach(() => {
  fakeTx.$queryRaw.mockReset();
  fakeTx.envFileVersion.findMany.mockReset();
  fakeTx.envFileVersion.findUnique.mockReset();
  fakeTx.envFileVersion.deleteMany.mockReset();
  fakeTransaction.mockClear();
  fakeDeleteObjects.mockReset();
  fakeDeleteObjects.mockResolvedValue(undefined);
  fakeTx.envFileVersion.deleteMany.mockResolvedValue({ count: 0 });
});

function makeVersionRow(version: number) {
  return {
    id: `ver_${version}`,
    r2Key: `workspaces/ws/projects/p/environments/e/versions/v${version}`,
  };
}

// Stage the FOR UPDATE row lock query to return a specific
// currentVersionId. Pass `null` for an env that never finalized.
// Pass `undefined` to simulate the env row being missing entirely.
function stageLockedEnv(currentVersionId: string | null | undefined) {
  if (currentVersionId === undefined) {
    fakeTx.$queryRaw.mockResolvedValueOnce([]);
  } else {
    fakeTx.$queryRaw.mockResolvedValueOnce([{ currentVersionId }]);
  }
}

describe('pruneEnvironmentHistory — degenerate inputs', () => {
  test('limit = 0 → no transaction, no R2 call', async () => {
    const result = await pruneEnvironmentHistory('env_1', 0);
    expect(result).toEqual({ prunedVersions: 0, prunedR2Objects: 0, r2Skipped: false });
    expect(fakeTransaction).not.toHaveBeenCalled();
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
  });

  test('negative limit → no transaction, no R2 call', async () => {
    const result = await pruneEnvironmentHistory('env_1', -10);
    expect(result.prunedVersions).toBe(0);
    expect(fakeTransaction).not.toHaveBeenCalled();
  });

  test('non-integer limit → no transaction, no R2 call', async () => {
    const result = await pruneEnvironmentHistory('env_1', 12.7);
    expect(result.prunedVersions).toBe(0);
    expect(fakeTransaction).not.toHaveBeenCalled();
  });

  test('missing environment (FOR UPDATE returns no row) → no-op, no candidate query', async () => {
    stageLockedEnv(undefined);
    const result = await pruneEnvironmentHistory('env_ghost', 50);
    expect(result.prunedVersions).toBe(0);
    expect(fakeTx.envFileVersion.findMany).not.toHaveBeenCalled();
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
  });
});

describe('pruneEnvironmentHistory — under / at cap (steady state)', () => {
  test('zero versions retained → no delete', async () => {
    stageLockedEnv(null);
    fakeTx.envFileVersion.findMany.mockResolvedValueOnce([]);
    const result = await pruneEnvironmentHistory('env_1', 50);
    expect(result.prunedVersions).toBe(0);
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
    expect(fakeTx.envFileVersion.deleteMany).not.toHaveBeenCalled();
  });

  test('exactly cap → no delete', async () => {
    stageLockedEnv('ver_50');
    const rows = Array.from({ length: 50 }, (_, i) => makeVersionRow(50 - i));
    fakeTx.envFileVersion.findMany.mockResolvedValueOnce(rows);
    const result = await pruneEnvironmentHistory('env_1', 50);
    expect(result.prunedVersions).toBe(0);
    expect(fakeDeleteObjects).not.toHaveBeenCalled();
    expect(fakeTx.envFileVersion.deleteMany).not.toHaveBeenCalled();
  });

  test('one under cap → no delete (take=limit+1 distinguishes)', async () => {
    stageLockedEnv('ver_49');
    const rows = Array.from({ length: 49 }, (_, i) => makeVersionRow(49 - i));
    fakeTx.envFileVersion.findMany.mockResolvedValueOnce(rows);
    const result = await pruneEnvironmentHistory('env_1', 50);
    expect(result.prunedVersions).toBe(0);
  });
});

describe('pruneEnvironmentHistory — over cap', () => {
  test('one over cap → exactly one row pruned', async () => {
    stageLockedEnv('ver_10');
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });
    fakeTx.envFileVersion.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await pruneEnvironmentHistory('env_1', 3);

    expect(result).toEqual({ prunedVersions: 1, prunedR2Objects: 1, r2Skipped: false });
    expect(fakeDeleteObjects).toHaveBeenCalledTimes(1);
    expect(fakeDeleteObjects.mock.calls[0]?.[0]).toEqual([
      'workspaces/ws/projects/p/environments/e/versions/v7',
    ]);
    expect(fakeTx.envFileVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ver_7'] } },
    });
  });

  test('many over cap → all over-cap rows pruned in one batch', async () => {
    stageLockedEnv('ver_100');
    const recent = Array.from({ length: 4 }, (_, i) => makeVersionRow(100 - i));
    const candidates = Array.from({ length: 97 }, (_, i) => makeVersionRow(97 - i));
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(candidates);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 98 });

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
    // v98) stay; everything else is a candidate EXCEPT v3 which the
    // id-guard must preserve.
    stageLockedEnv('ver_3');
    const recent = Array.from({ length: 4 }, (_, i) => makeVersionRow(100 - i));
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(Array.from({ length: 94 }, (_, i) => makeVersionRow(97 - i)));
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 98 });

    await pruneEnvironmentHistory('env_1', 3);

    const where = fakeTx.envFileVersion.findMany.mock.calls[1]?.[0]?.where as {
      environmentId: string;
      version: { lt: number };
      id: { not: string };
    };
    expect(where).toBeDefined();
    expect(where.id).toEqual({ not: 'ver_3' });
    expect(where.version).toEqual({ lt: 98 });
  });

  test('no current pointer (env never finalized) → no id-guard filter', async () => {
    stageLockedEnv(null);
    const recent = Array.from({ length: 4 }, (_, i) => makeVersionRow(100 - i));
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce(Array.from({ length: 97 }, (_, i) => makeVersionRow(97 - i)));
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 98 });

    await pruneEnvironmentHistory('env_1', 3);

    const where = fakeTx.envFileVersion.findMany.mock.calls[1]?.[0]?.where as {
      environmentId: string;
      id?: unknown;
    };
    expect(where.id).toBeUndefined();
  });
});

describe('pruneEnvironmentHistory — race-safety', () => {
  test('FOR UPDATE row lock fires inside the transaction (regression for CR#8)', async () => {
    stageLockedEnv('ver_10');
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });

    await pruneEnvironmentHistory('env_1', 3);

    expect(fakeTransaction).toHaveBeenCalledTimes(1);
    expect(fakeTx.$queryRaw).toHaveBeenCalledTimes(1);
    // Bun's mock.calls captures arguments — for tagged templates the
    // first argument is the cooked strings array. We verify the SQL
    // text contains "FOR UPDATE" to pin the lock semantics.
    const sqlChunks = fakeTx.$queryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(sqlChunks.join(' ')).toMatch(/FOR UPDATE/i);
    expect(sqlChunks.join(' ')).toMatch(/Environment/);
  });

  test('DB delete fires inside the transaction (current pointer cannot race in)', async () => {
    stageLockedEnv('ver_10');
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });

    await pruneEnvironmentHistory('env_1', 3);

    // The deleteMany must be on the tx client, not the global. Since
    // we never stub a global prisma.envFileVersion.deleteMany on
    // fakePrisma, exercising the live path proves the tx version was
    // used: an off-tx call would throw "is not a function".
    expect(fakeTx.envFileVersion.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('pruneEnvironmentHistory — R2 cleanup', () => {
  test('R2 throws non-config error AFTER tx commits → propagates; DB rows already deleted', async () => {
    stageLockedEnv('ver_10');
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });
    fakeTx.envFileVersion.deleteMany.mockResolvedValueOnce({ count: 1 });
    fakeDeleteObjects.mockRejectedValueOnce(new Error('R2 transient error'));

    await expect(pruneEnvironmentHistory('env_1', 3)).rejects.toThrow(/R2 transient error/);

    // The DB rows ARE deleted by the time we attempt R2 — that's the
    // tradeoff documented in version-sweep.ts. Orphaned R2 objects
    // get cleaned up by the retention-sweep cron, never the reverse.
    expect(fakeTx.envFileVersion.deleteMany).toHaveBeenCalledTimes(1);
  });

  test('R2-not-configured → DB rows still deleted, r2Skipped: true', async () => {
    stageLockedEnv('ver_10');
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });
    fakeTx.envFileVersion.deleteMany.mockResolvedValueOnce({ count: 1 });
    fakeDeleteObjects.mockRejectedValueOnce(new FakeR2NotConfigured());

    const result = await pruneEnvironmentHistory('env_1', 3);

    expect(result.prunedVersions).toBe(1);
    expect(result.prunedR2Objects).toBe(0);
    expect(result.r2Skipped).toBe(true);
    expect(fakeTx.envFileVersion.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('pruneEnvironmentHistory — ordering', () => {
  test('DB transaction commits before R2 delete is attempted', async () => {
    stageLockedEnv('ver_10');
    const recent = [makeVersionRow(10), makeVersionRow(9), makeVersionRow(8), makeVersionRow(7)];
    fakeTx.envFileVersion.findMany
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([makeVersionRow(7)]);
    fakeTx.envFileVersion.findUnique.mockResolvedValueOnce({ version: 8 });

    const order: string[] = [];
    fakeTx.envFileVersion.deleteMany.mockImplementationOnce(async () => {
      order.push('db');
      return { count: 1 };
    });
    fakeDeleteObjects.mockImplementationOnce(async () => {
      order.push('r2');
    });

    await pruneEnvironmentHistory('env_1', 3);

    expect(order).toEqual(['db', 'r2']);
  });
});
