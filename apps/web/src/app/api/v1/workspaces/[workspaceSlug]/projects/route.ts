import { prisma } from '@envstore/db';
import { projectCreateSchema } from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  requireUserAuth,
  resolveWorkspaceForAuth,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { createProject } from '@/lib/projects';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');

  const projects = await prisma.project.findMany({
    where: { workspaceId: ws.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      slug: true,
      name: true,
      description: true,
      group: { select: { slug: true, name: true } },
    },
  });
  return Response.json(
    projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      group: p.group ? { slug: p.group.slug, name: p.group.name } : null,
    })),
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;
  const { workspaceSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(userAuth, workspaceSlug);
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
    userId: userAuth.user.id,
    action: 'project.create',
    resourceType: 'project',
    resourceId: result.project.id,
    metadata: { slug: result.project.slug, via: 'cli' },
  });
  const created = await prisma.project.findUnique({
    where: { id: result.project.id },
    select: {
      slug: true,
      name: true,
      description: true,
      group: { select: { slug: true, name: true } },
    },
  });
  return Response.json(
    {
      slug: created!.slug,
      name: created!.name,
      description: created!.description,
      group: created!.group ? { slug: created!.group.slug, name: created!.group.name } : null,
    },
    { status: 201 },
  );
}
