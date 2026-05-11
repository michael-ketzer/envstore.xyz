'use server';

import { revalidatePath } from 'next/cache';

import { prisma } from '@envstore/db';
import { inviteCreateSchema, type WorkspaceRole } from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { createInvite } from '@/lib/invites';
import { hasAtLeastRole, getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

export type MembersActionState = { ok: boolean; error: string | null; info?: string };

export async function inviteMemberAction(
  workspaceSlug: string,
  _: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) return { ok: false, error: 'Only admins and owners can invite.' };
  if (membership.workspace.type === 'PERSONAL') {
    return { ok: false, error: 'Personal workspaces cannot have additional members.' };
  }

  const parsed = inviteCreateSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'MEMBER',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  // Only owners can grant OWNER (which is moot — we don't allow handing over ownership via invite).
  if (parsed.data.role === 'OWNER') {
    return { ok: false, error: 'OWNER cannot be assigned via invite.' };
  }
  if (parsed.data.role === 'ADMIN' && membership.role !== 'OWNER') {
    return { ok: false, error: 'Only the owner can invite admins.' };
  }

  const inviter = await prisma.user.findUnique({ where: { id: session.user.id } });
  const result = await createInvite({
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspace.name,
    workspaceSlug: membership.workspace.slug,
    invitedByUserId: session.user.id,
    inviterName: inviter?.name ?? inviter?.email ?? 'A teammate',
    email: parsed.data.email,
    role: parsed.data.role,
  });
  if (!result.ok) return { ok: false, error: result.message };
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'invite.create',
    resourceType: 'invite',
    resourceId: result.invite.id,
    metadata: { email: result.invite.email, role: parsed.data.role },
  });
  revalidatePath(`/dashboard/${workspaceSlug}/members`);
  return { ok: true, error: null, info: `Invite sent to ${result.invite.email}.` };
}

export async function revokeInviteAction(
  workspaceSlug: string,
  _: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) return { ok: false, error: 'Only admins and owners can revoke invites.' };

  const inviteId = String(formData.get('inviteId') ?? '');
  const invite = await prisma.invite.findFirst({
    where: { id: inviteId, workspaceId: membership.workspaceId, acceptedAt: null },
  });
  if (!invite) return { ok: false, error: 'Invite not found.' };

  await prisma.invite.delete({ where: { id: invite.id } });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'invite.revoke',
    resourceType: 'invite',
    resourceId: invite.id,
    metadata: { email: invite.email },
  });
  revalidatePath(`/dashboard/${workspaceSlug}/members`);
  return { ok: true, error: null };
}

export async function removeMemberAction(
  workspaceSlug: string,
  _: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) return { ok: false, error: 'Only admins and owners can remove members.' };

  const targetUserId = String(formData.get('userId') ?? '');
  if (targetUserId === session.user.id) {
    return { ok: false, error: 'You cannot remove yourself — leave via your own settings.' };
  }
  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: targetUserId } },
  });
  if (!target) return { ok: false, error: 'Member not found.' };
  if (target.role === 'OWNER') return { ok: false, error: 'The owner cannot be removed.' };
  if (target.role === 'ADMIN' && membership.role !== 'OWNER') {
    return { ok: false, error: 'Only the owner can remove admins.' };
  }

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: targetUserId } },
  });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'member.remove',
    resourceType: 'user',
    resourceId: targetUserId,
    metadata: { previousRole: target.role },
  });
  revalidatePath(`/dashboard/${workspaceSlug}/members`);
  return { ok: true, error: null };
}

export async function changeRoleAction(
  workspaceSlug: string,
  _: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'OWNER');
  if (!membership) return { ok: false, error: 'Only the owner can change roles.' };

  const targetUserId = String(formData.get('userId') ?? '');
  const newRole = String(formData.get('role') ?? '') as WorkspaceRole;
  if (newRole !== 'ADMIN' && newRole !== 'MEMBER') {
    return { ok: false, error: 'Role must be ADMIN or MEMBER.' };
  }
  if (targetUserId === session.user.id) {
    return { ok: false, error: 'You cannot change your own role.' };
  }
  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: targetUserId } },
  });
  if (!target) return { ok: false, error: 'Member not found.' };
  if (target.role === 'OWNER') return { ok: false, error: "Can't change the owner's role." };
  if (!hasAtLeastRole(membership.role as WorkspaceRole, 'OWNER')) {
    return { ok: false, error: 'Only the owner can change roles.' };
  }
  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: targetUserId } },
    data: { role: newRole },
  });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'member.role-change',
    resourceType: 'user',
    resourceId: targetUserId,
    metadata: { from: target.role, to: newRole },
  });
  revalidatePath(`/dashboard/${workspaceSlug}/members`);
  return { ok: true, error: null };
}
