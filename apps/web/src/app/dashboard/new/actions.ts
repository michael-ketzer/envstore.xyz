'use server';

import { redirect } from 'next/navigation';

import { workspaceCreateSchema } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { createTeamWorkspace } from '@/lib/workspaces';

export type CreateWorkspaceState = { error: string | null };

export async function createWorkspaceAction(
  _: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const session = await requireSession();
  const parsed = workspaceCreateSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const result = await createTeamWorkspace(session.user.id, parsed.data);
  if (!result.ok) return { error: result.message };
  redirect(`/dashboard/${result.workspace.slug}`);
}
