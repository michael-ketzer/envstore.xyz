// Hard-delete sweep. Soft-deleted workspaces, projects, project groups, and
// environments past their workspace's softDeleteRetentionDays get permanently
// removed — DB rows cascade through their children, and we explicitly nuke
// the matching R2 objects (the FK cascade won't do that for us).
//
// Idempotent: a second run is a no-op. Order matters — we delete R2 objects
// BEFORE removing the DB rows so we still have the keys; if R2 fails mid-way,
// the next run sees the same DB rows and retries.

import 'server-only';

import { prisma } from '@envstore/db';

import { deleteObjects, R2NotConfiguredError } from './r2';
import { recordAudit } from './audit';

export type SweepResult = {
  workspaces: number;
  projects: number;
  groups: number;
  environments: number;
  versions: number; // R2 objects removed
  r2Skipped: boolean; // true if R2 isn't configured; DB cleanup still happens
};

export async function runRetentionSweep(): Promise<SweepResult> {
  const now = new Date();
  const result: SweepResult = {
    workspaces: 0,
    projects: 0,
    groups: 0,
    environments: 0,
    versions: 0,
    r2Skipped: false,
  };

  // ----- Workspaces (cascade nukes everything under them) -----
  // We pull `deletedAt` and `softDeleteRetentionDays` together, then filter
  // server-side: Postgres can't easily compute "deletedAt + N days" inline
  // without an interval helper, so we do it in JS for clarity.
  const expiredWorkspaces = await prisma.workspace.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, slug: true, deletedAt: true, softDeleteRetentionDays: true },
  });
  for (const ws of expiredWorkspaces) {
    if (!isPastRetention(ws.deletedAt, ws.softDeleteRetentionDays, now)) continue;

    // Gather every R2 key under this workspace before the cascade wipes them.
    const versions = await prisma.envFileVersion.findMany({
      where: { environment: { project: { workspaceId: ws.id } } },
      select: { r2Key: true },
    });
    try {
      await deleteObjects(versions.map((v) => v.r2Key));
    } catch (err) {
      if (err instanceof R2NotConfiguredError) {
        result.r2Skipped = true;
      } else {
        throw err;
      }
    }
    result.versions += versions.length;

    await prisma.workspace.delete({ where: { id: ws.id } });
    result.workspaces += 1;
    await recordAudit({
      workspaceId: null,
      action: 'workspace.soft-delete',
      resourceType: 'workspace',
      resourceId: ws.id,
      metadata: { slug: ws.slug, hardDeleted: true, via: 'retention-sweep' },
    });
  }

  // ----- Projects under still-live workspaces -----
  const expiredProjects = await prisma.project.findMany({
    where: { deletedAt: { not: null }, workspace: { deletedAt: null } },
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      workspaceId: true,
      workspace: { select: { softDeleteRetentionDays: true } },
    },
  });
  for (const p of expiredProjects) {
    if (!isPastRetention(p.deletedAt, p.workspace.softDeleteRetentionDays, now)) continue;

    const versions = await prisma.envFileVersion.findMany({
      where: { environment: { projectId: p.id } },
      select: { r2Key: true },
    });
    try {
      await deleteObjects(versions.map((v) => v.r2Key));
    } catch (err) {
      if (err instanceof R2NotConfiguredError) {
        result.r2Skipped = true;
      } else {
        throw err;
      }
    }
    result.versions += versions.length;

    await prisma.project.delete({ where: { id: p.id } });
    result.projects += 1;
    await recordAudit({
      workspaceId: p.workspaceId,
      action: 'project.soft-delete',
      resourceType: 'project',
      resourceId: p.id,
      metadata: { slug: p.slug, hardDeleted: true, via: 'retention-sweep' },
    });
  }

  // ----- Environments under still-live projects -----
  const expiredEnvs = await prisma.environment.findMany({
    where: { deletedAt: { not: null }, project: { deletedAt: null } },
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      project: {
        select: {
          workspaceId: true,
          workspace: { select: { deletedAt: true, softDeleteRetentionDays: true } },
        },
      },
    },
  });
  for (const e of expiredEnvs) {
    if (e.project.workspace.deletedAt) continue; // workspace-level sweep owns it
    if (!isPastRetention(e.deletedAt, e.project.workspace.softDeleteRetentionDays, now)) continue;

    const versions = await prisma.envFileVersion.findMany({
      where: { environmentId: e.id },
      select: { r2Key: true },
    });
    try {
      await deleteObjects(versions.map((v) => v.r2Key));
    } catch (err) {
      if (err instanceof R2NotConfiguredError) {
        result.r2Skipped = true;
      } else {
        throw err;
      }
    }
    result.versions += versions.length;

    await prisma.environment.delete({ where: { id: e.id } });
    result.environments += 1;
    await recordAudit({
      workspaceId: e.project.workspaceId,
      action: 'environment.soft-delete',
      resourceType: 'environment',
      resourceId: e.id,
      metadata: { slug: e.slug, hardDeleted: true, via: 'retention-sweep' },
    });
  }

  // ----- Project groups (no R2 to nuke — groups don't own versions) -----
  const expiredGroups = await prisma.projectGroup.findMany({
    where: { deletedAt: { not: null }, workspace: { deletedAt: null } },
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      workspaceId: true,
      workspace: { select: { softDeleteRetentionDays: true } },
    },
  });
  for (const g of expiredGroups) {
    if (!isPastRetention(g.deletedAt, g.workspace.softDeleteRetentionDays, now)) continue;
    await prisma.projectGroup.delete({ where: { id: g.id } });
    result.groups += 1;
    await recordAudit({
      workspaceId: g.workspaceId,
      action: 'projectGroup.soft-delete',
      resourceType: 'projectGroup',
      resourceId: g.id,
      metadata: { slug: g.slug, hardDeleted: true, via: 'retention-sweep' },
    });
  }

  return result;
}

function isPastRetention(deletedAt: Date | null, retentionDays: number, now: Date): boolean {
  if (!deletedAt) return false;
  const expiresAt = deletedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000;
  return expiresAt < now.getTime();
}
