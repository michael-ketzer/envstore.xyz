'use server';

import { revalidatePath } from 'next/cache';

import { prisma } from '@envstore/db';

import { requireSession } from '@/lib/auth-helpers';
import {
  WorkspaceAccessDeniedError,
  requireWorkspaceWrite,
} from '@/lib/billing';
import { getWorkspaceForUser } from '@/lib/workspaces';

export type RollbackState = { error: string | null; ok: boolean };

export async function rollbackToVersionAction(
  workspaceSlug: string,
  projectSlug: string,
  envSlug: string,
  versionId: string,
  _: RollbackState,
  _formData: FormData,
): Promise<RollbackState> {
  const session = await requireSession();

  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id);
  if (!ws) return { ok: false, error: 'Workspace not found.' };

  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
    select: {
      id: true,
      workspaceId: true,
      workspace: {
        select: {
          type: true,
          subscription: {
            select: {
              status: true,
              trialEndsAt: true,
              canceledAt: true,
              paddleSubscriptionId: true,
            },
          },
        },
      },
    },
  });
  if (!project) return { ok: false, error: 'Project not found.' };

  try {
    requireWorkspaceWrite(project.workspace);
  } catch (err) {
    if (err instanceof WorkspaceAccessDeniedError) {
      return { ok: false, error: err.access.message };
    }
    throw err;
  }

  const environment = await prisma.environment.findFirst({
    where: { projectId: project.id, slug: envSlug, deletedAt: null },
    select: { id: true, slug: true, currentVersionId: true },
  });
  if (!environment) return { ok: false, error: 'Environment not found.' };

  const target = await prisma.envFileVersion.findFirst({
    where: { id: versionId, environmentId: environment.id },
    select: { id: true, version: true },
  });
  if (!target) return { ok: false, error: 'Version not found.' };

  // Cheap no-op short-circuit. The transaction below re-checks under
  // its own read so two concurrent rollbacks can't both emit an audit
  // for the same effective change.
  if (environment.currentVersionId === target.id) {
    return { ok: true, error: null };
  }

  // Compare-and-swap pointer flip + audit in one transaction. The
  // re-read inside `tx` makes the audit's `previousVersionId` reflect
  // the value we actually replaced; the updateMany's `where` clause
  // (id + currentVersionId) ensures we ONLY write — and audit — when
  // no other rollback has raced in. A losing CAS returns success with
  // no audit emitted, matching the API route's behavior.
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.environment.findUnique({
      where: { id: environment.id },
      select: { currentVersionId: true, slug: true },
    });
    if (!fresh) return;
    if (fresh.currentVersionId === target.id) return;

    const updated = await tx.environment.updateMany({
      where: { id: environment.id, currentVersionId: fresh.currentVersionId },
      data: { currentVersionId: target.id },
    });
    if (updated.count === 0) return;

    await tx.auditLog.create({
      data: {
        workspaceId: project.workspaceId,
        userId: session.user.id,
        action: 'environment.update',
        resourceType: 'environment',
        resourceId: environment.id,
        metadata: {
          env: fresh.slug,
          rolledBackTo: target.version,
          previousVersionId: fresh.currentVersionId ?? null,
          via: 'dashboard',
        },
      },
    });
  });

  revalidatePath(
    `/dashboard/${workspaceSlug}/${projectSlug}/environments/${envSlug}`,
  );
  revalidatePath(`/dashboard/${workspaceSlug}/${projectSlug}`);
  return { ok: true, error: null };
}
