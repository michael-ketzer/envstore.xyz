// GET /api/v1/workspaces/[ws]/projects/[proj]/pull?env=<slug>[&version=<int>]
//
// Returns a presigned GET URL for the requested env version. With no `version`,
// resolves to the environment's currentVersionId. Auth-gated by workspace
// membership.

import { prisma } from '@envstore/db';
import {
  bytesToHex,
} from '@envstore/crypto/hash';
import {
  environmentSlugSchema,
} from '@envstore/shared';
import { z } from 'zod';

import {
  apiError,
  authenticateBearer,
  notFound,
  resolveWorkspaceForAuth,
  tokenAllowsProject,
  unauthorized,
} from '@/lib/api-auth';
import { presignGet, R2NotConfiguredError } from '@/lib/r2';

type Ctx = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

const querySchema = z.object({
  env: environmentSlugSchema,
  version: z.coerce.number().int().positive().optional(),
});

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug } = await ctx.params;
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    env: url.searchParams.get('env'),
    version: url.searchParams.get('version') ?? undefined,
  });
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid query.', 400);
  }

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  // Resolve the project first so we can run the token project-scope gate
  // before doing any environment work.
  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
    select: { id: true },
  });
  if (!project) return notFound('Project not found.');
  if (!tokenAllowsProject(auth, project.id)) {
    return apiError('Service token is not scoped to this project.', 403);
  }
  const environment = await prisma.environment.findFirst({
    where: {
      projectId: project.id,
      slug: parsed.data.env,
      deletedAt: null,
    },
    include: {
      currentVersion: {
        select: {
          id: true,
          version: true,
          r2Key: true,
          ciphertextSize: true,
          ciphertextSha256: true,
          recipientsHash: true,
        },
      },
      // Workspace type lets the CLI display "me/<project>" for personal
      // workspaces in its success message.
      project: { select: { workspace: { select: { type: true } } } },
    },
  });
  if (!environment) return notFound('Environment not found.');

  let version;
  if (parsed.data.version !== undefined) {
    version = await prisma.envFileVersion.findUnique({
      where: {
        environmentId_version: {
          environmentId: environment.id,
          version: parsed.data.version,
        },
      },
      select: {
        id: true,
        version: true,
        r2Key: true,
        ciphertextSize: true,
        ciphertextSha256: true,
        recipientsHash: true,
      },
    });
  } else {
    version = environment.currentVersion;
  }
  if (!version) {
    return apiError(
      parsed.data.version !== undefined
        ? `Version ${parsed.data.version} not found.`
        : 'Environment has no pushed version yet.',
      404,
    );
  }

  let presigned;
  try {
    presigned = await presignGet(version.r2Key);
  } catch (err) {
    if (err instanceof R2NotConfiguredError) return apiError(err.message, 503);
    throw err;
  }

  return Response.json({
    versionId: version.id,
    version: version.version,
    environmentSlug: environment.slug,
    workspaceType: environment.project.workspace.type,
    ciphertextSize: version.ciphertextSize,
    ciphertextSha256: bytesToHex(new Uint8Array(version.ciphertextSha256)),
    recipientsHash: bytesToHex(new Uint8Array(version.recipientsHash)),
    downloadUrl: presigned.url,
    expiresIn: presigned.expiresIn,
  });
}
