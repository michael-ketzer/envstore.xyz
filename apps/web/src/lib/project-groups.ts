import 'server-only';

import { prisma, type Prisma } from '@envstore/db';
import {
  PERSONAL_WORKSPACE_URL_SLUG,
  validateSlug,
  type ProjectGroupCreateInput,
  type ProjectGroupUpdateInput,
} from '@envstore/shared';

export type CreateProjectGroupResult =
  | { ok: true; group: { id: string; slug: string } }
  | { ok: false; reason: 'slug-taken' | 'invalid-slug'; message: string };

export async function createProjectGroup(
  workspaceId: string,
  input: ProjectGroupCreateInput,
): Promise<CreateProjectGroupResult> {
  const slugCheck = validateSlug(input.slug);
  if (!slugCheck.ok) return { ok: false, reason: 'invalid-slug', message: slugCheck.reason };

  const existing = await prisma.projectGroup.findUnique({
    where: { workspaceId_slug: { workspaceId, slug: input.slug } },
  });
  if (existing && !existing.deletedAt) {
    return {
      ok: false,
      reason: 'slug-taken',
      message: 'A group with that slug already exists in this workspace.',
    };
  }
  if (existing) {
    return {
      ok: false,
      reason: 'slug-taken',
      message: 'A deleted group still holds this slug — use a different one or purge it first.',
    };
  }

  const group = await prisma.projectGroup.create({
    data: {
      workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description,
    },
    select: { id: true, slug: true },
  });
  return { ok: true, group };
}

// Resolve a group slug to a ProjectGroup id, creating a row on the fly if no
// match exists. Used by project create/update so the CLI can keep passing a
// bare slug without making a separate "create group" call first.
export async function resolveOrCreateProjectGroupId(
  workspaceId: string,
  slug: string,
): Promise<string | null> {
  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) return null;

  const existing = await prisma.projectGroup.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
    select: { id: true, deletedAt: true },
  });
  if (existing && !existing.deletedAt) return existing.id;
  if (existing) {
    // Resurrect a soft-deleted group rather than reject — the CLI flow is "the
    // user named this folder, give me a place to put projects". Hard cleanup
    // is the workspace owner's job.
    await prisma.projectGroup.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });
    return existing.id;
  }

  const created = await prisma.projectGroup.create({
    data: { workspaceId, slug, name: slug },
    select: { id: true },
  });
  return created.id;
}

export async function getProjectGroupForUser<TInclude extends Prisma.ProjectGroupInclude>(
  workspaceSlug: string,
  groupSlug: string,
  userId: string,
  include?: TInclude,
): Promise<Prisma.ProjectGroupGetPayload<{ include: TInclude }> | null> {
  const workspaceWhere: Prisma.WorkspaceWhereInput =
    workspaceSlug === PERSONAL_WORKSPACE_URL_SLUG
      ? { ownerId: userId, type: 'PERSONAL', deletedAt: null }
      : { slug: workspaceSlug, deletedAt: null, members: { some: { userId } } };
  const group = await prisma.projectGroup.findFirst({
    where: {
      slug: groupSlug,
      deletedAt: null,
      workspace: workspaceWhere,
    },
    include: include as Prisma.ProjectGroupInclude,
  });
  return (group as Prisma.ProjectGroupGetPayload<{ include: TInclude }>) ?? null;
}

export type UpdateProjectGroupResult =
  | { ok: true }
  | { ok: false; reason: 'not-found'; message: string };

export async function updateProjectGroup(
  workspaceId: string,
  groupSlug: string,
  input: ProjectGroupUpdateInput,
): Promise<UpdateProjectGroupResult> {
  const existing = await prisma.projectGroup.findUnique({
    where: { workspaceId_slug: { workspaceId, slug: groupSlug } },
    select: { id: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return { ok: false, reason: 'not-found', message: 'Group not found.' };
  }
  await prisma.projectGroup.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      description: input.description,
    },
  });
  return { ok: true };
}

// Soft-delete the group and unassign its projects (they survive as standalone).
// The schema's onDelete: SetNull would handle a hard delete, but here we leave
// the tombstone in place to honor the workspace's soft-delete retention window.
export async function softDeleteProjectGroup(
  workspaceId: string,
  groupSlug: string,
): Promise<UpdateProjectGroupResult> {
  const existing = await prisma.projectGroup.findUnique({
    where: { workspaceId_slug: { workspaceId, slug: groupSlug } },
    select: { id: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return { ok: false, reason: 'not-found', message: 'Group not found.' };
  }
  await prisma.$transaction([
    prisma.project.updateMany({
      where: { groupId: existing.id },
      data: { groupId: null },
    }),
    prisma.projectGroup.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    }),
  ]);
  return { ok: true };
}
