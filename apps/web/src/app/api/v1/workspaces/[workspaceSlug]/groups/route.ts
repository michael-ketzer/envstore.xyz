import { prisma } from '@envstore/db';
import { projectGroupCreateSchema } from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  requireUserAuth,
  resolveWorkspaceForAuth,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { createProjectGroup } from '@/lib/project-groups';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

// Project-scoped service tokens shouldn't be browsing workspace-level
// metadata — groups (and their names/descriptions) are organizational
// information that a token scoped to one project has no need to see. We
// 403 instead of filtering because there's no "groups for project X" view
// today, and forcing the caller to a no-op response would just be lying.
function denyProjectScopedToken(auth: Parameters<typeof requireUserAuth>[0]): Response | null {
  if (auth.kind === 'workspace-token' && auth.token.scopedProjectIds.length > 0) {
    return apiError(
      'Project-scoped service tokens cannot browse workspace-level group metadata.',
      403,
    );
  }
  return null;
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  const denied = denyProjectScopedToken(auth);
  if (denied) return denied;

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
    userId: userAuth.user.id,
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
