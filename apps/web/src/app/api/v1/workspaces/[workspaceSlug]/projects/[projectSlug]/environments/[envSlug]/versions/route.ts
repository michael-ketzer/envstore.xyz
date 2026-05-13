// GET /api/v1/workspaces/[ws]/projects/[proj]/environments/[env]/versions
//
// Lists the version history for one environment, newest-first. Returns
// metadata only — never the ciphertext. Used by the dashboard's history
// drawer and by the CLI's `envstore versions` command.
//
// Auth: any workspace member OR a workspace-scoped service token whose
// project allowlist covers this project. Read-tier billing access is
// enough; locked workspaces can still pull and inspect history.

import { prisma } from '@envstore/db';
import {
  environmentSlugSchema,
  versionListQuerySchema,
  type VersionListResponse,
} from '@envstore/shared';

import {
  apiError,
  authenticateBearer,
  notFound,
  resolveWorkspaceForAuth,
  tokenAllowsProject,
  unauthorized,
} from '@/lib/api-auth';
import {
  WorkspaceAccessDeniedError,
  requireWorkspaceRead,
} from '@/lib/billing';

type Ctx = {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    envSlug: string;
  }>;
};

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug, envSlug } = await ctx.params;

  const slugCheck = environmentSlugSchema.safeParse(envSlug);
  if (!slugCheck.success) {
    return apiError(slugCheck.error.issues[0]?.message ?? 'Invalid env slug.', 400);
  }

  const url = new URL(req.url);
  const parsedQuery = versionListQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsedQuery.success) {
    return apiError(
      parsedQuery.error.issues[0]?.message ?? 'Invalid query.',
      400,
    );
  }
  const { limit, cursor } = parsedQuery.data;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');

  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
    select: {
      id: true,
      workspace: {
        select: {
          versionHistoryLimit: true,
          type: true,
          subscription: {
            select: {
              status: true,
              trialEndsAt: true,
              canceledAt: true,
              paddleSubscriptionId: true,
            },
          },
        },
      },
    },
  });
  if (!project) return notFound('Project not found.');
  if (!tokenAllowsProject(auth, project.id)) {
    return apiError('Service token is not scoped to this project.', 403);
  }

  try {
    requireWorkspaceRead(project.workspace);
  } catch (err) {
    if (err instanceof WorkspaceAccessDeniedError) {
      return apiError(err.access.message, 402, 'Open billing in the dashboard to resubscribe.');
    }
    throw err;
  }

  const environment = await prisma.environment.findFirst({
    where: { projectId: project.id, slug: envSlug, deletedAt: null },
    select: { id: true, slug: true, currentVersionId: true },
  });
  if (!environment) return notFound('Environment not found.');

  // Cursor is the version-id of the LAST row from a previous page; we
  // resolve it to its `version` integer and ask for anything strictly
  // older. Keyset pagination on the monotonic `version` column is cheap
  // and stable under inserts/deletes.
  let beforeVersion: number | undefined;
  if (cursor) {
    const cursorRow = await prisma.envFileVersion.findFirst({
      where: { id: cursor, environmentId: environment.id },
      select: { version: true },
    });
    if (!cursorRow) {
      return apiError('Invalid cursor.', 400);
    }
    beforeVersion = cursorRow.version;
  }

  const rows = await prisma.envFileVersion.findMany({
    where: {
      environmentId: environment.id,
      ...(beforeVersion !== undefined ? { version: { lt: beforeVersion } } : {}),
    },
    orderBy: { version: 'desc' },
    take: limit,
    select: {
      id: true,
      version: true,
      ciphertextSize: true,
      comment: true,
      createdAt: true,
      createdBy: { select: { email: true } },
    },
  });

  const body: VersionListResponse = {
    environmentSlug: environment.slug,
    versions: rows.map((r) => ({
      id: r.id,
      version: r.version,
      ciphertextSize: r.ciphertextSize,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      createdByEmail: r.createdBy?.email ?? null,
      current: r.id === environment.currentVersionId,
    })),
    versionHistoryLimit: project.workspace.versionHistoryLimit,
  };

  return Response.json(body);
}
