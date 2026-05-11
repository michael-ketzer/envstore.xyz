'use server';

import { redirect } from 'next/navigation';

import { projectCreateSchema } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { createProjectGroup } from '@/lib/project-groups';
import { createProject } from '@/lib/projects';
import { getWorkspaceForUser } from '@/lib/workspaces';

export type CreateProjectState = { error: string | null };

const NEW_GROUP_SENTINEL = '__new__';

export async function createProjectAction(
  workspaceSlug: string,
  _: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const session = await requireSession();
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {});
  if (!ws) return { error: 'Workspace not found.' };

  // Group field can be: empty (standalone), an existing group slug, or the
  // sentinel (create a new group from `new-group-name`, server picks the slug).
  const rawGroup = (formData.get('group') as string | null)?.trim();
  let resolvedGroupSlug: string | undefined;
  if (rawGroup === NEW_GROUP_SENTINEL) {
    const newGroupName = (formData.get('new-group-name') as string | null)?.trim();
    if (!newGroupName) return { error: 'New group name is required.' };
    const groupResult = await createProjectGroup(ws.id, { name: newGroupName });
    if (!groupResult.ok) return { error: groupResult.message };
    resolvedGroupSlug = groupResult.group.slug;
  } else if (rawGroup) {
    resolvedGroupSlug = rawGroup;
  }

  const parsed = projectCreateSchema.safeParse({
    // Slug is intentionally omitted — the server auto-generates one from the
    // name. The CLI still supplies an explicit slug via the API.
    name: formData.get('name'),
    description: (formData.get('description') as string)?.trim() || undefined,
    group: resolvedGroupSlug,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const result = await createProject(ws.id, parsed.data);
  if (!result.ok) return { error: result.message };
  redirect(`/dashboard/${workspaceSlug}/${result.project.slug}`);
}
