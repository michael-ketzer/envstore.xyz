import { prisma } from '@envstore/db';

import { authenticateBearer, notFound, unauthorized } from '@/lib/api-auth';

type Ctx = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug } = await ctx.params;

  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      deletedAt: null,
      workspace: {
        slug: workspaceSlug,
        deletedAt: null,
        members: { some: { userId: auth.user.id } },
      },
    },
    select: { id: true },
  });
  if (!project) return notFound('Project not found.');

  const envs = await prisma.environment.findMany({
    where: { projectId: project.id, deletedAt: null },
    include: {
      currentVersion: {
        select: { version: true, createdAt: true, ciphertextSize: true },
      },
      _count: { select: { versions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return Response.json(
    envs.map((env) => ({
      slug: env.slug,
      name: env.name,
      currentVersion: env.currentVersion
        ? {
            version: env.currentVersion.version,
            createdAt: env.currentVersion.createdAt.toISOString(),
            ciphertextSize: env.currentVersion.ciphertextSize,
          }
        : null,
      versionsCount: env._count.versions,
    })),
  );
}
