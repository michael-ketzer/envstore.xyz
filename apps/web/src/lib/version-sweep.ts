// Per-environment version-history sweep.
//
// On every successful push (after finalize flips Environment.currentVersionId)
// we walk the environment's versions, ordered newest-first, and prune
// everything beyond the workspace's `versionHistoryLimit`. The current
// pointer is ALWAYS preserved regardless of position — if for some reason
// it's older than the cap (e.g. after a rollback to an ancient version),
// it still survives.
//
// R2 cleanup happens BEFORE the DB row delete so a crash mid-sweep leaves
// the DB row referencing a still-present R2 object, which is recoverable
// on the next pass — the inverse (DB row gone but R2 object lingering)
// would leak storage cost forever with no row to walk back from.
//
// Inline-on-finalize was chosen over cron because:
//   - constant per-push work (a few seconds of R2 deletes at most)
//   - no drift between R2 and DB
//   - no separate cron piece to monitor
//
// The retention-sweep cron is unchanged; it still owns the soft-delete →
// hard-delete path for whole environments/projects/workspaces.

import 'server-only';

import { prisma } from '@envstore/db';

import { deleteObjects, R2NotConfiguredError } from './r2';

export type PruneResult = {
  /** Versions deleted (DB rows). */
  prunedVersions: number;
  /** R2 objects requested for delete (count of keys passed to deleteObjects). */
  prunedR2Objects: number;
  /** True when R2 isn't configured — DB cleanup still happened. */
  r2Skipped: boolean;
};

const ZERO_RESULT: PruneResult = {
  prunedVersions: 0,
  prunedR2Objects: 0,
  r2Skipped: false,
};

export async function pruneEnvironmentHistory(
  environmentId: string,
  limit: number,
): Promise<PruneResult> {
  if (!Number.isInteger(limit) || limit < 1) return ZERO_RESULT;

  // Resolve the live current pointer once. If we picked it up inside the
  // findMany window below we'd race against a concurrent rollback. It's
  // OK to be slightly stale here — the worst case is preserving an
  // about-to-be-replaced row for one more push cycle.
  const env = await prisma.environment.findUnique({
    where: { id: environmentId },
    select: { currentVersionId: true },
  });
  if (!env) return ZERO_RESULT;
  const currentVersionId = env.currentVersionId;

  // Newest-first ordering: take ids beyond the cap to prune. We fetch
  // ONE extra (limit+1) before deciding whether anything is over-cap so
  // a no-op push doesn't do a second query.
  const recent = await prisma.envFileVersion.findMany({
    where: { environmentId },
    orderBy: { version: 'desc' },
    select: { id: true, r2Key: true },
    take: limit + 1,
  });

  // Under cap or exactly at cap → nothing to prune. Common steady-state path.
  if (recent.length <= limit) return ZERO_RESULT;

  // Beyond cap. Find ALL the over-cap rows (newest..limit are kept, the
  // rest are candidates) — recent[limit..] are the first prune candidates,
  // and there may be MORE beyond what the take=limit+1 returned, so do a
  // second findMany scoped to "older than the oldest kept" instead of
  // paginating.
  const oldestKept = recent[limit - 1]!;
  const oldestKeptRow = await prisma.envFileVersion.findUnique({
    where: { id: oldestKept.id },
    select: { version: true },
  });
  if (!oldestKeptRow) return ZERO_RESULT;

  const candidates = await prisma.envFileVersion.findMany({
    where: {
      environmentId,
      version: { lt: oldestKeptRow.version },
      // Defensive: never sweep the current pointer, even if it's somehow
      // older than the cap (post-rollback to an ancient version).
      ...(currentVersionId ? { id: { not: currentVersionId } } : {}),
    },
    select: { id: true, r2Key: true },
  });
  if (candidates.length === 0) return ZERO_RESULT;

  // R2 first — if it fails we propagate, leaving DB rows intact so the
  // next push gets another shot. Already-deleted keys are silent successes
  // per deleteObjects' Quiet: true behavior.
  let r2Skipped = false;
  try {
    await deleteObjects(candidates.map((c) => c.r2Key));
  } catch (err) {
    if (err instanceof R2NotConfiguredError) {
      r2Skipped = true;
    } else {
      throw err;
    }
  }

  // Then the DB rows. deleteMany is atomic at the SQL level so we don't
  // half-delete on transient connection drop.
  const ids = candidates.map((c) => c.id);
  await prisma.envFileVersion.deleteMany({ where: { id: { in: ids } } });

  return {
    prunedVersions: ids.length,
    prunedR2Objects: r2Skipped ? 0 : ids.length,
    r2Skipped,
  };
}
