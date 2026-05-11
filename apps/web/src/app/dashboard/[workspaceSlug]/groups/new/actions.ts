'use server';

import { redirect } from 'next/navigation';

import { projectGroupCreateSchema } from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { createProjectGroup } from '@/lib/project-groups';
import { getWorkspaceForUser } from '@/lib/workspaces';

export type CreateGroupState = { error: string | null };

export async function createGroupAction(
  workspaceSlug: string,
  _: CreateGroupState,
  formData: FormData,
): Promise<CreateGroupState> {
  const session = await requireSession();
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {});
  if (!ws) return { error: 'Workspace not found.' };

  const parsed = projectGroupCreateSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    description: (formData.get('description') as string)?.trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const result = await createProjectGroup(ws.id, parsed.data);
  if (!result.ok) return { error: result.message };

  await recordAudit({
    workspaceId: ws.id,
    userId: session.user.id,
    action: 'projectGroup.create',
    resourceType: 'projectGroup',
    resourceId: result.group.id,
    metadata: { slug: result.group.slug, via: 'web' },
  });
  redirect(`/dashboard/${workspaceSlug}/groups/${result.group.slug}`);
}
