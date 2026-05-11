import 'server-only';

import { prisma } from '@envstore/db';
import { validateSlug, type EnvironmentCreateInput } from '@envstore/shared';

export type CreateEnvironmentResult =
  | { ok: true; environment: { id: string; slug: string } }
  | { ok: false; reason: 'slug-taken' | 'invalid-slug'; message: string };

export async function createEnvironment(
  projectId: string,
  input: EnvironmentCreateInput,
): Promise<CreateEnvironmentResult> {
  const slugCheck = validateSlug(input.slug);
  if (!slugCheck.ok) return { ok: false, reason: 'invalid-slug', message: slugCheck.reason };

  const existing = await prisma.environment.findUnique({
    where: { projectId_slug: { projectId, slug: input.slug } },
  });
  if (existing) {
    return {
      ok: false,
      reason: 'slug-taken',
      message: existing.deletedAt
        ? 'A deleted environment still holds this slug — pick a different one or purge it first.'
        : 'An environment with that slug already exists in this project.',
    };
  }

  const environment = await prisma.environment.create({
    data: { projectId, slug: input.slug, name: input.name },
    select: { id: true, slug: true },
  });
  return { ok: true, environment };
}
