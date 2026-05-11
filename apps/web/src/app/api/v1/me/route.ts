import { prisma } from '@envstore/db';

import { authenticateBearer, requireUserAuth, unauthorized } from '@/lib/api-auth';

export async function GET(req: Request) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;

  const [memberships, recipients] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId: userAuth.user.id, workspace: { deletedAt: null } },
      include: { workspace: { select: { slug: true, name: true, type: true } } },
      orderBy: [{ workspace: { type: 'asc' } }, { joinedAt: 'asc' }],
    }),
    prisma.userRecipient.findMany({
      where: { userId: userAuth.user.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return Response.json({
    user: { id: userAuth.user.id, email: userAuth.user.email, name: userAuth.user.name ?? null },
    workspaces: memberships.map((m) => ({
      slug: m.workspace.slug,
      name: m.workspace.name,
      type: m.workspace.type,
      role: m.role,
    })),
    recipients: recipients.map((r) => ({
      id: r.id,
      recipient: r.recipient,
      kind: r.kind,
      label: r.label,
    })),
  });
}
