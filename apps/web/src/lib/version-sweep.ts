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

  // Phase 1 (inside a transaction with a row lock on the environment):
  //   - acquire SELECT ... FOR UPDATE on the Environment row. This
  //     serializes against any concurrent rollback (which the rollback
  //     route now also runs in a transaction touching the same row),
  //     so currentVersionId is stable for the duration of the prune.
  //   - re-read currentVersionId under the lock — the only safe value
  //     to exclude from the prune candidate set.
  //   - compute the candidate ids (everything older than the cap,
  //     minus the live pointer) and DELETE the DB rows.
  //
  // Phase 2 (outside the transaction):
  //   - delete the matching R2 objects. Doing this OUTSIDE the lock is
  //     deliberate: R2 calls go over the network and we don't want to
  //     hold a row lock for the duration. The DB rows are gone, so
  //     workspace members can't see them anymore. If R2 cleanup fails,
  //     the result is orphaned R2 objects (no DB row pointing at them);
  //     the retention-sweep cron handles those on a future pass. The
  //     reverse — DB rows pointing at deleted R2 objects — would break
  //     pull and is worse, which is why we deliberately don't keep the
  //     old "R2 before DB" ordering.
  type Candidate = { id: string; r2Key: string };
  let candidates: Candidate[] = [];

  await prisma.$transaction(async (tx) => {
    // Lock the Environment row. If it doesn't exist, abort with no
    // candidates — the outer function returns ZERO_RESULT.
    const locked = await tx.$queryRaw<{ currentVersionId: string | null }[]>`
      SELECT "currentVersionId"
      FROM "Environment"
      WHERE id = ${environmentId}
      FOR UPDATE
    `;
    if (locked.length === 0) return;
    const currentVersionId = locked[0]!.currentVersionId;

    // Newest-first probe of limit+1 rows: if we got ≤ limit, nothing
    // is over-cap and we exit the transaction with no candidates.
    const recent = await tx.envFileVersion.findMany({
      where: { environmentId },
      orderBy: { version: 'desc' },
      select: { id: true, r2Key: true },
      take: limit + 1,
    });
    if (recent.length <= limit) return;

    // Beyond cap. The over-cap set may extend further back than
    // limit+1; resolve the oldest-kept row's version, then sweep
    // everything strictly older than it (excluding the current
    // pointer if it ended up in that range, e.g. post-rollback to an
    // ancient version).
    const oldestKept = recent[limit - 1]!;
    const oldestKeptRow = await tx.envFileVersion.findUnique({
      where: { id: oldestKept.id },
      select: { version: true },
    });
    if (!oldestKeptRow) return;

    candidates = await tx.envFileVersion.findMany({
      where: {
        environmentId,
        version: { lt: oldestKeptRow.version },
        ...(currentVersionId ? { id: { not: currentVersionId } } : {}),
      },
      select: { id: true, r2Key: true },
    });
    if (candidates.length === 0) return;

    await tx.envFileVersion.deleteMany({
      where: { id: { in: candidates.map((c) => c.id) } },
    });
  });

  if (candidates.length === 0) return ZERO_RESULT;

  // Phase 2: nuke the R2 objects. Best-effort; failures here leave
  // orphans for the retention cron to clean up.
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

  return {
    prunedVersions: candidates.length,
    prunedR2Objects: r2Skipped ? 0 : candidates.length,
    r2Skipped,
  };
}
