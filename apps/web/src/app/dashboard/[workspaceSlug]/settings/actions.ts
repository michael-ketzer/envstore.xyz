'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@envstore/db';
import {
  LIMITS,
  workspaceRenameSlugSchema,
  workspaceUpdateSchema,
} from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { renameWorkspaceSlug } from '@/lib/workspaces';
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

export async function renameWorkspaceSlugAction(
  currentSlug: string,
  _: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(currentSlug, session.user.id, 'OWNER');
  if (!membership) {
    return { ok: false, error: 'Only the owner can change the workspace slug.' };
  }
  if (membership.workspace.type === 'PERSONAL') {
    return {
      ok: false,
      error: 'Personal workspaces use the fixed /me URL — no slug change needed.',
    };
  }

  const parsed = workspaceRenameSlugSchema.safeParse({
    slug: (formData.get('slug') as string)?.trim().toLowerCase() ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid slug.' };
  }
  const confirm = (formData.get('confirm') as string)?.trim();
  if (confirm !== currentSlug) {
    return { ok: false, error: `Type "${currentSlug}" to confirm — this breaks links.` };
  }

  const result = await renameWorkspaceSlug(membership.workspaceId, parsed.data.slug);
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'workspace.update',
    resourceType: 'workspace',
    resourceId: membership.workspaceId,
    metadata: { slugFrom: currentSlug, slugTo: result.slug },
  });
  redirect(`/dashboard/${result.slug}/settings?renamed=1`);
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
