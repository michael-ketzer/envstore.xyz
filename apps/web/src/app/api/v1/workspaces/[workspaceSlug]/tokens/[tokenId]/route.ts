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
import { revokeWorkspaceToken } from '@/lib/workspace-tokens';
import { prisma } from '@envstore/db';

type Ctx = { params: Promise<{ workspaceSlug: string; tokenId: string }> };

async function requireAdmin(workspaceId: string, userId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!m) return false;
  return hasAtLeastRole(m.role as 'OWNER' | 'ADMIN' | 'MEMBER', 'ADMIN');
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;
  const { workspaceSlug, tokenId } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(userAuth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  if (!(await requireAdmin(ws.id, userAuth.user.id))) {
    return apiError('Only admins and owners can revoke workspace tokens.', 403);
  }

  const result = await revokeWorkspaceToken(ws.id, tokenId);
  if (!result.ok) return notFound('Token not found.');

  await recordAudit({
    workspaceId: ws.id,
    userId: userAuth.user.id,
    action: 'workspaceToken.revoke',
    resourceType: 'workspaceToken',
    resourceId: tokenId,
  });
  return Response.json({ ok: true });
}
