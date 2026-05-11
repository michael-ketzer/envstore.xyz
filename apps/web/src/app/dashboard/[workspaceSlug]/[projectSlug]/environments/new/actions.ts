'use server';

import { redirect } from 'next/navigation';

import { environmentCreateSchema } from '@envstore/shared';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { createEnvironment } from '@/lib/environments';
import { getProjectForUser } from '@/lib/projects';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

export type CreateEnvState = { error: string | null };

export async function createEnvironmentAction(
  workspaceSlug: string,
  projectSlug: string,
  _: CreateEnvState,
  formData: FormData,
): Promise<CreateEnvState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'MEMBER');
  if (!membership) return { error: 'You are not a member of this workspace.' };

  const project = await getProjectForUser(workspaceSlug, projectSlug, session.user.id, {});
  if (!project) return { error: 'Project not found.' };

  const parsed = environmentCreateSchema.safeParse({
    slug: formData.get('slug'),
    name: (formData.get('name') as string)?.trim() || formData.get('slug'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const result = await createEnvironment(project.id, parsed.data);
  if (!result.ok) return { error: result.message };

  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'environment.create',
    resourceType: 'environment',
    resourceId: result.environment.id,
    metadata: { projectId: project.id, slug: result.environment.slug },
  });
  redirect(`/dashboard/${workspaceSlug}/${projectSlug}`);
}
