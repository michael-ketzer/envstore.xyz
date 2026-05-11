'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { prisma } from '@envstore/db';
import { LIMITS, workspaceUpdateSchema } from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

export type SettingsState = { error: string | null; ok: boolean };

const updateFormSchema = workspaceUpdateSchema.extend({
  // Form fields arrive as strings; coerce retentionDays back to number.
  softDeleteRetentionDays: z.coerce.number().int().min(0).max(365).optional(),
});

export async function updateWorkspaceAction(
  workspaceSlug: string,
  _: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) return { ok: false, error: 'Only admins and owners can change settings.' };

  const rawDescription = (formData.get('description') as string | null) ?? null;
  const description =
    rawDescription === null ? undefined : rawDescription.trim() === '' ? null : rawDescription.trim();

  const parsed = updateFormSchema.safeParse({
    name: (formData.get('name') as string)?.trim() || undefined,
    description,
    softDeleteRetentionDays:
      formData.get('softDeleteRetentionDays') !== null
        ? formData.get('softDeleteRetentionDays')
        : undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.softDeleteRetentionDays !== undefined) {
    data.softDeleteRetentionDays = parsed.data.softDeleteRetentionDays;
  }
  if (Object.keys(data).length === 0) return { ok: true, error: null };

  await prisma.workspace.update({ where: { id: membership.workspaceId }, data });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'workspace.update',
    resourceType: 'workspace',
    resourceId: membership.workspaceId,
    metadata: data,
  });
  revalidatePath(`/dashboard/${workspaceSlug}`);
  revalidatePath(`/dashboard/${workspaceSlug}/settings`);
  return { ok: true, error: null };
}

export async function softDeleteWorkspaceAction(
  workspaceSlug: string,
  _: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'OWNER');
  if (!membership) return { ok: false, error: 'Only the owner can delete this workspace.' };
  if (membership.workspace.type === 'PERSONAL') {
    return {
      ok: false,
      error:
        'Personal workspaces cannot be deleted from here. Use Account → Delete account when that lands.',
    };
  }
  const confirm = (formData.get('confirm') as string)?.trim();
  if (confirm !== workspaceSlug) {
    return { ok: false, error: `Type "${workspaceSlug}" to confirm.` };
  }
  // Cap confirmation length so a huge form value can't bloat the log.
  if (confirm.length > LIMITS.slugMax) {
    return { ok: false, error: 'Invalid confirmation value.' };
  }

  await prisma.workspace.update({
    where: { id: membership.workspaceId },
    data: { deletedAt: new Date() },
  });
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'workspace.soft-delete',
    resourceType: 'workspace',
    resourceId: membership.workspaceId,
  });
  redirect('/dashboard');
}
