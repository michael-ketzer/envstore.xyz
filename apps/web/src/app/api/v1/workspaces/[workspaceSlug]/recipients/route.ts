// Returns every recipient registered by every member of this workspace.
// The CLI encrypts pushed env files to ALL of these so any member can decrypt
// with their own local identity.

import { prisma } from '@envstore/db';
import { PERSONAL_WORKSPACE_URL_SLUG } from '@envstore/shared';

import {
  authenticateBearer,
  notFound,
  unauthorized,
} from '@/lib/api-auth';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug } = await ctx.params;

  // Resolve workspace, supporting the `me` shortcut for the caller's personal workspace.
  const workspace =
    workspaceSlug === PERSONAL_WORKSPACE_URL_SLUG
      ? await prisma.workspace.findFirst({
          where: { ownerId: auth.user.id, type: 'PERSONAL', deletedAt: null },
          select: { id: true, slug: true, type: true },
        })
      : await prisma.workspace.findFirst({
          where: {
            slug: workspaceSlug,
            deletedAt: null,
            members: { some: { userId: auth.user.id } },
          },
          select: { id: true, slug: true, type: true },
        });
  if (!workspace) return notFound('Workspace not found.');

  // Pull every member's recipients in one go.
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: workspace.id },
    select: {
      userId: true,
      user: {
        select: {
          email: true,
          recipients: {
            select: { id: true, recipient: true, kind: true, label: true },
          },
        },
      },
    },
  });

  const recipients = members.flatMap((m) =>
    m.user.recipients.map((r) => ({
      id: r.id,
      recipient: r.recipient,
      kind: r.kind,
      label: r.label,
      userEmail: m.user.email,
    })),
  );

  return Response.json({
    workspace: { slug: workspace.slug, type: workspace.type },
    recipients,
  });
}
