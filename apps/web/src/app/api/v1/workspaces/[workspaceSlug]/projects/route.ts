import { prisma } from '@envstore/db';
import { projectCreateSchema } from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { createProject } from '@/lib/projects';

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

  const projects = await prisma.project.findMany({
    where: { workspaceId: ws.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { slug: true, name: true, description: true, group: true },
  });
  return Response.json(projects);
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
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  const result = await createProject(ws.id, parsed.data);
  if (!result.ok) {
    const status = result.reason === 'slug-taken' ? 409 : 400;
    return apiError(result.message, status);
  }
  await recordAudit({
    workspaceId: ws.id,
    userId: auth.user.id,
    action: 'project.create',
    resourceType: 'project',
    resourceId: result.project.id,
    metadata: { slug: result.project.slug, via: 'cli' },
  });
  return Response.json(
    {
      slug: result.project.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      group: parsed.data.group ?? null,
    },
    { status: 201 },
  );
}
