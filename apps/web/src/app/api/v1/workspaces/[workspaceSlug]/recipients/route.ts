// Returns every recipient that should receive a copy of a pushed env file —
// every workspace member's identities + every active service token whose
// project scope covers the named project.
//
// Query: `?project=<slug>` filters out tokens scoped to OTHER projects. If
// omitted, returns workspace-wide tokens only (project-scoped tokens are
// excluded since we can't tell which project they'd apply to). The CLI's
// push command always passes the project it's about to encrypt for.

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

  // Optional project filter — only relevant for the token-scoping logic.
  const url = new URL(req.url);
  const projectSlug = url.searchParams.get('project');
  let projectId: string | null = null;
  if (projectSlug) {
    const proj = await prisma.project.findFirst({
      where: { workspaceId: workspace.id, slug: projectSlug, deletedAt: null },
      select: { id: true },
    });
    if (!proj) return notFound('Project not found.');
    projectId = proj.id;
  }

  // Pull every member's recipients PLUS every active service token. Token
  // filtering happens in JS below — the scopedProjectIds array isn't easily
  // expressed as a Prisma where-clause that handles "empty array = match all".
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
      select: {
        id: true,
        name: true,
        recipient: true,
        recipientKind: true,
        scopedProjectIds: true,
      },
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
  // Token recipient filtering:
  //   - workspace-wide token (scope empty): always included.
  //   - project-scoped token + no projectSlug given: EXCLUDED. Without
  //     project context we can't know which scope applies, and including
  //     them would expand the effective ciphertext audience.
  //   - project-scoped token + projectSlug given: included iff the project
  //     is in the token's scope.
  const tokenRecipients = tokens
    .filter((t) => {
      if (t.scopedProjectIds.length === 0) return true;
      if (!projectId) return false;
      return t.scopedProjectIds.includes(projectId);
    })
    .map((t) => ({
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
