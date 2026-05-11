// Returns every recipient registered by every member of this workspace.
// The CLI encrypts pushed env files to ALL of these so any member can decrypt
// with their own local identity.

import { prisma } from '@envstore/db';

import {
  authenticateBearer,
  notFound,
  resolveWorkspaceForAuth,
  unauthorized,
} from '@/lib/api-auth';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  const workspace = await prisma.workspace.findUnique({
    where: { id: ws.id },
    select: { id: true, slug: true, type: true },
  });
  if (!workspace) return notFound('Workspace not found.');

  // Pull every member's recipients PLUS every active service token's recipient
  // — both sets need the encrypted payload so any holder can decrypt.
  const [members, tokens] = await Promise.all([
    prisma.workspaceMember.findMany({
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
    }),
    prisma.workspaceToken.findMany({
      where: { workspaceId: workspace.id, revokedAt: null },
      select: { id: true, name: true, recipient: true, recipientKind: true },
    }),
  ]);

  const userRecipients = members.flatMap((m) =>
    m.user.recipients.map((r) => ({
      id: r.id,
      recipient: r.recipient,
      kind: r.kind,
      label: r.label,
      userEmail: m.user.email,
    })),
  );
  // Service tokens look just like human recipients to the CLI — the `userEmail`
  // is null so the CLI can render them distinctly if it cares; for encryption
  // purposes they're members of the same recipient set.
  const tokenRecipients = tokens.map((t) => ({
    id: t.id,
    recipient: t.recipient,
    kind: t.recipientKind,
    label: `token:${t.name}`,
    userEmail: null,
  }));

  return Response.json({
    workspace: { slug: workspace.slug, type: workspace.type },
    recipients: [...userRecipients, ...tokenRecipients],
  });
}
