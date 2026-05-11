import 'server-only';

import { prisma, type Prisma } from '@envstore/db';
import {
  PERSONAL_WORKSPACE_URL_SLUG,
  validateSlug,
  type ProjectCreateInput,
} from '@envstore/shared';

import { pickUniqueLinkCode } from './project-link-codes';
import { resolveOrCreateProjectGroupId } from './project-groups';

export type CreateProjectResult =
  | { ok: true; project: { id: string; slug: string } }
  | { ok: false; reason: 'slug-taken' | 'invalid-slug'; message: string };

export async function createProject(
  workspaceId: string,
  input: ProjectCreateInput,
): Promise<CreateProjectResult> {
  const slugCheck = validateSlug(input.slug);
  if (!slugCheck.ok) return { ok: false, reason: 'invalid-slug', message: slugCheck.reason };

  const existing = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId, slug: input.slug } },
  });
  if (existing && !existing.deletedAt) {
    return {
      ok: false,
      reason: 'slug-taken',
      message: 'A project with that slug already exists in this workspace.',
    };
  }
  // If it exists but is soft-deleted, treat as taken to avoid resurrecting a
  // tombstoned project by accident; user can hard-delete it from settings later.
  if (existing) {
    return {
      ok: false,
      reason: 'slug-taken',
      message: 'A deleted project still holds this slug — use a different one or purge it first.',
    };
  }

  const groupId = input.group
    ? await resolveOrCreateProjectGroupId(workspaceId, input.group)
    : null;

  const project = await prisma.project.create({
    data: {
      workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      groupId,
      // Stable setup code shown on the project page; surfaced by `envstore link <CODE>`.
      linkCode: await pickUniqueLinkCode(),
    },
    select: { id: true, slug: true },
  });
  return { ok: true, project };
}

// Apply a `group` update from the API: null means "unassign", a slug means
// "move to that group (creating it if needed)".
export async function applyProjectGroupChange(
  workspaceId: string,
  projectId: string,
  group: string | null,
): Promise<void> {
  const groupId = group === null ? null : await resolveOrCreateProjectGroupId(workspaceId, group);
  await prisma.project.update({
    where: { id: projectId },
    data: { groupId },
  });
}

export async function getProjectForUser<TInclude extends Prisma.ProjectInclude>(
  workspaceSlug: string,
  projectSlug: string,
  userId: string,
  include?: TInclude,
): Promise<Prisma.ProjectGetPayload<{ include: TInclude }> | null> {
  const workspaceWhere: Prisma.WorkspaceWhereInput =
    workspaceSlug === PERSONAL_WORKSPACE_URL_SLUG
      ? { ownerId: userId, type: 'PERSONAL', deletedAt: null }
      : { slug: workspaceSlug, deletedAt: null, members: { some: { userId } } };
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      deletedAt: null,
      workspace: workspaceWhere,
    },
    include: include as Prisma.ProjectInclude,
  });
  return (project as Prisma.ProjectGetPayload<{ include: TInclude }>) ?? null;
}
