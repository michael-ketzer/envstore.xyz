'use server';

import { redirect } from 'next/navigation';

import { projectCreateSchema } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { createProject } from '@/lib/projects';
import { getWorkspaceForUser } from '@/lib/workspaces';

export type CreateProjectState = { error: string | null };

export async function createProjectAction(
  workspaceSlug: string,
  _: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const session = await requireSession();
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {});
  if (!ws) return { error: 'Workspace not found.' };

  const parsed = projectCreateSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    description: (formData.get('description') as string)?.trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const result = await createProject(ws.id, parsed.data);
  if (!result.ok) return { error: result.message };
  redirect(`/dashboard/${workspaceSlug}/${result.project.slug}`);
}
