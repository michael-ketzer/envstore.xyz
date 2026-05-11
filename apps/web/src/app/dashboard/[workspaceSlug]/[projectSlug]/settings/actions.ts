'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { prisma } from '@envstore/db';
import { projectUpdateSchema } from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { getProjectForUser } from '@/lib/projects';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

export type ProjectSettingsState = { ok: boolean; error: string | null };

export async function updateProjectAction(
  workspaceSlug: string,
  projectSlug: string,
  _: ProjectSettingsState,
  formData: FormData,
): Promise<ProjectSettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'MEMBER');
  if (!membership) return { ok: false, error: 'You are not a member of this workspace.' };

  const project = await getProjectForUser(workspaceSlug, projectSlug, session.user.id, {});
  if (!project) return { ok: false, error: 'Project not found.' };

  const parsed = projectUpdateSchema.safeParse({
    name: (formData.get('name') as string)?.trim() || undefined,
    description: ((formData.get('description') as string) ?? '').trim() || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (Object.keys(data).length === 0) return { ok: true, error: null };

  await prisma.project.update({ where: { id: project.id }, data });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'project.update',
    resourceType: 'project',
    resourceId: project.id,
    metadata: data,
  });
  revalidatePath(`/dashboard/${workspaceSlug}/${projectSlug}`);
  revalidatePath(`/dashboard/${workspaceSlug}/${projectSlug}/settings`);
  return { ok: true, error: null };
}

export async function softDeleteProjectAction(
  workspaceSlug: string,
  projectSlug: string,
  _: ProjectSettingsState,
  formData: FormData,
): Promise<ProjectSettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) return { ok: false, error: 'Only admins and owners can delete projects.' };

  const project = await getProjectForUser(workspaceSlug, projectSlug, session.user.id, {});
  if (!project) return { ok: false, error: 'Project not found.' };

  const confirm = (formData.get('confirm') as string)?.trim();
  if (confirm !== projectSlug) {
    return { ok: false, error: `Type "${projectSlug}" to confirm.` };
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { deletedAt: new Date() },
  });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'project.soft-delete',
    resourceType: 'project',
    resourceId: project.id,
  });
  redirect(`/dashboard/${workspaceSlug}`);
}
