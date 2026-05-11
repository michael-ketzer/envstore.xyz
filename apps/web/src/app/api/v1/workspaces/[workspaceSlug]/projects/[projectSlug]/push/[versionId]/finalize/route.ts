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
  authenticateBearer,
  notFound,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { headObject, R2NotConfiguredError } from '@/lib/r2';

type Ctx = {
  params: Promise<{ workspaceSlug: string; projectSlug: string; versionId: string }>;
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug, versionId } = await ctx.params;

  const version = await prisma.envFileVersion.findFirst({
    where: {
      id: versionId,
      environment: {
        deletedAt: null,
        project: {
          slug: projectSlug,
          deletedAt: null,
          workspace: {
            deletedAt: null,
            OR: [
              { slug: workspaceSlug, members: { some: { userId: auth.user.id } } },
              ...(workspaceSlug === 'me'
                ? [{ ownerId: auth.user.id, type: 'PERSONAL' as const }]
                : []),
            ],
          },
        },
      },
    },
    include: {
      environment: { select: { id: true, slug: true, project: { select: { workspaceId: true } } } },
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

  await recordAudit({
    workspaceId: version.environment.project.workspaceId,
    userId: auth.user.id,
    action: 'environment.update',
    resourceType: 'envFileVersion',
    resourceId: version.id,
    metadata: {
      env: version.environment.slug,
      version: version.version,
      finalized: true,
      via: 'cli',
    },
  });

  return Response.json({
    versionId: version.id,
    version: version.version,
    environmentSlug: version.environment.slug,
  });
}
