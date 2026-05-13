// POST /api/v1/workspaces/[ws]/projects/[proj]/push/[versionId]/finalize
//
// Called by the CLI after its successful PUT to the presigned URL. We:
//   1. HEAD the R2 object to confirm it landed and the size matches what the CLI
//      announced at init. (We don't recompute sha256 — that would force a full
//      download of every upload. The CLI is trusted for hash correctness;
//      decryption failure on pull would surface tampering anyway.)
//   2. Flip Environment.currentVersionId to this version so subsequent pulls
//      return it.

import { prisma } from '@envstore/db';

import {
  apiError,
  auditFieldsFor,
  authenticateBearer,
  notFound,
  requireWriteScope,
  resolveWorkspaceForAuth,
  tokenAllowsProject,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { headObject, R2NotConfiguredError } from '@/lib/r2';
import { pruneEnvironmentHistory } from '@/lib/version-sweep';

type Ctx = {
  params: Promise<{ workspaceSlug: string; projectSlug: string; versionId: string }>;
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug, versionId } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
    select: { id: true },
  });
  if (!project) return notFound('Project not found.');
  if (!tokenAllowsProject(auth, project.id)) {
    return apiError('Service token is not scoped to this project.', 403);
  }
  const scopeDenied = requireWriteScope(auth);
  if (scopeDenied) return scopeDenied;
  const version = await prisma.envFileVersion.findFirst({
    where: {
      id: versionId,
      environment: { deletedAt: null, projectId: project.id },
    },
    include: {
      environment: {
        select: {
          id: true,
          slug: true,
          project: {
            select: {
              workspaceId: true,
              workspace: { select: { versionHistoryLimit: true } },
            },
          },
        },
      },
    },
  });
  if (!version) return notFound('Version not found.');

  // Confirm R2 has the object at the announced size.
  let head;
  try {
    head = await headObject(version.r2Key);
  } catch (err) {
    if (err instanceof R2NotConfiguredError) return apiError(err.message, 503);
    throw err;
  }
  if (!head) {
    return apiError('Upload not detected at R2. Re-run `envstore push`.', 410);
  }
  if (head.contentLength !== version.ciphertextSize) {
    return apiError(
      `Upload size mismatch: declared ${version.ciphertextSize}, R2 has ${head.contentLength}.`,
      409,
    );
  }

  // Flip the rollback pointer to this version.
  await prisma.environment.update({
    where: { id: version.environment.id },
    data: { currentVersionId: version.id },
  });

  // Inline version-history sweep — drop oldest rows + their R2 objects
  // beyond the workspace cap. Don't let prune errors fail the push: the
  // version IS finalized and pulls would work even if cleanup is
  // deferred. We record any error in audit metadata for visibility.
  const versionHistoryLimit =
    version.environment.project.workspace.versionHistoryLimit;
  let pruneError: string | null = null;
  let prunedVersions = 0;
  let prunedR2Objects = 0;
  let r2Skipped = false;
  try {
    const result = await pruneEnvironmentHistory(
      version.environment.id,
      versionHistoryLimit,
    );
    prunedVersions = result.prunedVersions;
    prunedR2Objects = result.prunedR2Objects;
    r2Skipped = result.r2Skipped;
  } catch (err) {
    pruneError = (err as Error).message;
    // Log only the error message string — never spread the full exception, which
    // can carry SDK response bodies, headers, or other operational data that
    // shouldn't land in runtime logs.
    console.error('Version-history prune failed:', pruneError);
  }

  await recordAudit({
    workspaceId: version.environment.project.workspaceId,
    ...auditFieldsFor(auth),
    action: 'environment.update',
    resourceType: 'envFileVersion',
    resourceId: version.id,
    metadata: {
      env: version.environment.slug,
      version: version.version,
      finalized: true,
      via: auth.kind === 'workspace-token' ? 'workspace-token' : 'cli',
      ...(prunedVersions > 0
        ? { prunedVersions, prunedR2Objects, r2Skipped }
        : {}),
      ...(pruneError ? { pruneError } : {}),
    },
  });

  return Response.json({
    versionId: version.id,
    version: version.version,
    environmentSlug: version.environment.slug,
  });
}
