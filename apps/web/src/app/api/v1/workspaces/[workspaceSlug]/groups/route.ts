import { prisma } from '@envstore/db';
import { projectGroupCreateSchema } from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { createProjectGroup } from '@/lib/project-groups';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

async function workspaceForUser(workspaceSlug: string, userId: string) {
  return prisma.workspace.findFirst({
    where: {
      slug: workspaceSlug,
      deletedAt: null,
      members: { some: { userId } },
    },
    select: { id: true, slug: true },
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug } = await ctx.params;

  const ws = await workspaceForUser(workspaceSlug, auth.user.id);
  if (!ws) return notFound('Workspace not found.');

  const groups = await prisma.projectGroup.findMany({
    where: { workspaceId: ws.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      slug: true,
      name: true,
      description: true,
      _count: { select: { projects: { where: { deletedAt: null } } } },
    },
  });
  return Response.json(
    groups.map((g) => ({
      slug: g.slug,
      name: g.name,
      description: g.description,
      projectCount: g._count.projects,
    })),
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug } = await ctx.params;

  const ws = await workspaceForUser(workspaceSlug, auth.user.id);
  if (!ws) return notFound('Workspace not found.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = projectGroupCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  const result = await createProjectGroup(ws.id, parsed.data);
  if (!result.ok) {
    const status = result.reason === 'slug-taken' ? 409 : 400;
    return apiError(result.message, status);
  }
  await recordAudit({
    workspaceId: ws.id,
    userId: auth.user.id,
    action: 'projectGroup.create',
    resourceType: 'projectGroup',
    resourceId: result.group.id,
    metadata: { slug: result.group.slug, via: 'cli' },
  });
  return Response.json(
    {
      slug: result.group.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      projectCount: 0,
    },
    { status: 201 },
  );
}
