import 'server-only';
import { randomBytes } from 'node:crypto';

import { prisma, type Prisma } from '@envstore/db';
import {
  LIMITS,
  PERSONAL_WORKSPACE_URL_SLUG,
  slugify,
  validateSlug,
  type ProjectCreateInput,
} from '@envstore/shared';

import { pickUniqueLinkCode } from './project-link-codes';
import { resolveOrCreateProjectGroupId } from './project-groups';

// Generate a workspace-unique slug from a display name by appending a short
// hex suffix. The web "new project" form doesn't ask for a slug anymore — the
// suffix guarantees uniqueness without the user picking one.
async function pickUniqueProjectSlug(workspaceId: string, name: string): Promise<string> {
  const base = slugify(name) || 'project';
  for (let i = 0; i < 8; i++) {
    const suffix = randomBytes(2).toString('hex');
    const candidate = `${base}-${suffix}`.slice(0, LIMITS.slugMax);
    const clash = await prisma.project.findUnique({
      where: { workspaceId_slug: { workspaceId, slug: candidate } },
    });
    if (!clash) return candidate;
  }
  throw new Error('Failed to allocate a unique project slug.');
}

export type CreateProjectResult =
  | { ok: true; project: { id: string; slug: string } }
  | { ok: false; reason: 'slug-taken' | 'invalid-slug'; message: string };

export async function createProject(
  workspaceId: string,
  input: ProjectCreateInput,
): Promise<CreateProjectResult> {
  // When `slug` is supplied (CLI path), respect the user's choice and treat
  // a collision as an error. When it's omitted (web "new project" form),
  // auto-generate `<slugify(name)>-<random>` for guaranteed uniqueness.
  let slug: string;
  if (input.slug) {
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
    if (existing) {
      return {
        ok: false,
        reason: 'slug-taken',
        message: 'A deleted project still holds this slug — use a different one or purge it first.',
      };
    }
    slug = input.slug;
  } else {
    slug = await pickUniqueProjectSlug(workspaceId, input.name);
  }

  const groupId = input.group
    ? await resolveOrCreateProjectGroupId(workspaceId, input.group)
    : null;

  const project = await prisma.project.create({
    data: {
      workspaceId,
      slug,
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
