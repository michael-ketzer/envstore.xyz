'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { projectGroupUpdateSchema } from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import {
  getProjectGroupForUser,
  softDeleteProjectGroup,
  updateProjectGroup,
} from '@/lib/project-groups';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

export type GroupSettingsState = { ok: boolean; error: string | null };

export async function updateGroupAction(
  workspaceSlug: string,
  groupSlug: string,
  _: GroupSettingsState,
  formData: FormData,
): Promise<GroupSettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'MEMBER');
  if (!membership) return { ok: false, error: 'You are not a member of this workspace.' };

  const group = await getProjectGroupForUser(workspaceSlug, groupSlug, session.user.id, {});
  if (!group) return { ok: false, error: 'Group not found.' };

  const parsed = projectGroupUpdateSchema.safeParse({
    name: (formData.get('name') as string)?.trim() || undefined,
    description: ((formData.get('description') as string) ?? '').trim() || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const result = await updateProjectGroup(membership.workspaceId, groupSlug, parsed.data);
  if (!result.ok) return { ok: false, error: result.message };

  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'projectGroup.update',
    resourceType: 'projectGroup',
    resourceId: group.id,
    metadata: parsed.data,
  });
  revalidatePath(`/dashboard/${workspaceSlug}`);
  revalidatePath(`/dashboard/${workspaceSlug}/groups/${groupSlug}`);
  revalidatePath(`/dashboard/${workspaceSlug}/groups/${groupSlug}/settings`);
  return { ok: true, error: null };
}

export async function deleteGroupAction(
  workspaceSlug: string,
  groupSlug: string,
  _: GroupSettingsState,
  formData: FormData,
): Promise<GroupSettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) return { ok: false, error: 'Only admins and owners can delete groups.' };

  const group = await getProjectGroupForUser(workspaceSlug, groupSlug, session.user.id, {});
  if (!group) return { ok: false, error: 'Group not found.' };

  const confirm = (formData.get('confirm') as string)?.trim();
  if (confirm !== groupSlug) {
    return { ok: false, error: `Type "${groupSlug}" to confirm.` };
  }

  const result = await softDeleteProjectGroup(membership.workspaceId, groupSlug);
  if (!result.ok) return { ok: false, error: result.message };

  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'projectGroup.soft-delete',
    resourceType: 'projectGroup',
    resourceId: group.id,
  });
  redirect(`/dashboard/${workspaceSlug}`);
}
