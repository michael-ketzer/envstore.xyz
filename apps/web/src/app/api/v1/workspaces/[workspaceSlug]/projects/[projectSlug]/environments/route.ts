import { prisma } from '@envstore/db';

import {
  authenticateBearer,
  notFound,
  resolveWorkspaceForAuth,
  unauthorized,
} from '@/lib/api-auth';

type Ctx = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');

  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
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
