import { prisma } from '@envstore/db';
import { projectGroupUpdateSchema } from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import {
  getProjectGroupForUser,
  softDeleteProjectGroup,
  updateProjectGroup,
} from '@/lib/project-groups';

type Ctx = { params: Promise<{ workspaceSlug: string; groupSlug: string }> };

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
  const { workspaceSlug, groupSlug } = await ctx.params;

  const group = await getProjectGroupForUser(workspaceSlug, groupSlug, auth.user.id, {
    projects: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { slug: true, name: true, description: true },
    },
  });
  if (!group) return notFound('Group not found.');

  return Response.json({
    slug: group.slug,
    name: group.name,
    description: group.description,
    projects: group.projects,
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, groupSlug } = await ctx.params;

  const ws = await workspaceForUser(workspaceSlug, auth.user.id);
  if (!ws) return notFound('Workspace not found.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = projectGroupUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  const result = await updateProjectGroup(ws.id, groupSlug, parsed.data);
  if (!result.ok) {
    return apiError(result.message, 404);
  }
  await recordAudit({
    workspaceId: ws.id,
    userId: auth.user.id,
    action: 'projectGroup.update',
    resourceType: 'projectGroup',
    metadata: { slug: groupSlug, via: 'cli' },
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, groupSlug } = await ctx.params;

  const ws = await workspaceForUser(workspaceSlug, auth.user.id);
  if (!ws) return notFound('Workspace not found.');

  const result = await softDeleteProjectGroup(ws.id, groupSlug);
  if (!result.ok) {
    return apiError(result.message, 404);
  }
  await recordAudit({
    workspaceId: ws.id,
    userId: auth.user.id,
    action: 'projectGroup.soft-delete',
    resourceType: 'projectGroup',
    metadata: { slug: groupSlug, via: 'cli' },
  });
  return Response.json({ ok: true });
}
