// CI/CD service tokens scoped to one workspace. The bearer minted here is
// shown ONCE in the response; the server stores only its sha256.
//
// Only user-auth is accepted on these endpoints (see `requireUserAuth`) —
// tokens cannot mint other tokens, which keeps a single leaked token from
// escalating into a persistent attacker foothold.

import { workspaceTokenCreateSchema } from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  requireUserAuth,
  resolveWorkspaceForAuth,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { hasAtLeastRole } from '@/lib/workspace-roles';
import {
  createWorkspaceToken,
  listWorkspaceTokens,
} from '@/lib/workspace-tokens';
import { prisma } from '@envstore/db';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

// Mint + revoke require workspace ADMIN. MEMBER can't create tokens because
// a token is a workspace-wide read/write credential — same blast radius as
// inviting a new member, which MEMBER also can't do.
async function requireAdmin(workspaceId: string, userId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!m) return false;
  return hasAtLeastRole(m.role as 'OWNER' | 'ADMIN' | 'MEMBER', 'ADMIN');
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;
  const { workspaceSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(userAuth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  if (!(await requireAdmin(ws.id, userAuth.user.id))) {
    return apiError('Only admins and owners can view workspace tokens.', 403);
  }

  const tokens = await listWorkspaceTokens(ws.id);
  return Response.json({ tokens });
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;
  const { workspaceSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(userAuth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  if (!(await requireAdmin(ws.id, userAuth.user.id))) {
    return apiError('Only admins and owners can create workspace tokens.', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = workspaceTokenCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  const result = await createWorkspaceToken({
    workspaceId: ws.id,
    createdByUserId: userAuth.user.id,
    input: parsed.data,
  });
  if (!result.ok) {
    const status = result.reason === 'unknown-project' ? 400 : 400;
    return apiError(result.message, status);
  }
  await recordAudit({
    workspaceId: ws.id,
    userId: userAuth.user.id,
    action: 'workspaceToken.create',
    resourceType: 'workspaceToken',
    resourceId: result.token.id,
    metadata: {
      name: result.token.name,
      expiresAt: result.token.expiresAt?.toISOString() ?? null,
      scopedProjects: result.token.scopedProjects.map((p) => p.slug),
    },
  });
  // The bearer is returned exactly once — the only opportunity the caller has
  // to save it. Subsequent GETs never include it.
  return Response.json(
    {
      id: result.token.id,
      name: result.token.name,
      recipient: result.token.recipient,
      scopes: result.token.scopes,
      scopedProjects: result.token.scopedProjects,
      expiresAt: result.token.expiresAt?.toISOString() ?? null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: result.token.createdAt.toISOString(),
      createdByEmail: userAuth.user.email,
      token: result.bearer,
    },
    { status: 201 },
  );
}
