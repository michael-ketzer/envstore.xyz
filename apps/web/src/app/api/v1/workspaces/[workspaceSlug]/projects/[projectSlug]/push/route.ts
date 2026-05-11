// POST /api/v1/workspaces/[ws]/projects/[proj]/push — init a push.
//
// Idempotently auto-creates the environment if it doesn't exist (matches the
// CLI's filename-detected env, e.g. `.env.production` → `production`). Creates
// a NEW version row in a "draft" state — `currentVersionId` is NOT updated
// until the matching `/finalize` confirms the R2 upload succeeded.
//
// The version row is durable; if finalize never fires, a daily cron sweeps
// orphaned versions (TODO) — for now they sit harmlessly in the DB and the R2
// object is just never created.

import { prisma } from '@envstore/db';
import { hexToBytes } from '@envstore/crypto/hash';
import {
  LIMITS,
  environmentSlugSchema,
  validateSlug,
} from '@envstore/shared';
import { z } from 'zod';

import {
  apiError,
  auditFieldsFor,
  authenticateBearer,
  notFound,
  resolveWorkspaceForAuth,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import {
  WorkspaceAccessDeniedError,
  requireWorkspaceWrite,
} from '@/lib/billing';
import { buildVersionKey, presignPut, R2NotConfiguredError } from '@/lib/r2';

type Ctx = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

const pushInitSchema = z.object({
  env: environmentSlugSchema,
  ciphertextSize: z
    .number()
    .int()
    .positive()
    .max(LIMITS.maxCiphertextBytes),
  ciphertextSha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be lowercase hex(64)'),
  recipientsHash: z.string().regex(/^[0-9a-f]{64}$/, 'recipientsHash must be lowercase hex(64)'),
  comment: z.string().max(LIMITS.commentMax).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug } = await ctx.params;

  const ws = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!ws) return notFound('Workspace not found.');
  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
    select: {
      id: true,
      workspaceId: true,
      workspace: {
        select: {
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

  // Billing gate — writes (pushes) require 'full' access. Trial-expired,
  // canceled-past-grace, etc. workspaces are read-only or locked.
  try {
    requireWorkspaceWrite(project.workspace);
  } catch (err) {
    if (err instanceof WorkspaceAccessDeniedError) {
      return apiError(err.access.message, 402, 'Open billing in the dashboard to resubscribe.');
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = pushInitSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }
  // Belt-and-braces: enforce slug validation here too (Zod regex matches, but
  // this gives a friendlier message and centralizes the rule).
  const slugCheck = validateSlug(parsed.data.env);
  if (!slugCheck.ok) return apiError(slugCheck.reason, 400);

  // Auto-create environment on first push.
  const environment = await prisma.environment.upsert({
    where: { projectId_slug: { projectId: project.id, slug: parsed.data.env } },
    update: {},
    create: {
      projectId: project.id,
      slug: parsed.data.env,
      name: parsed.data.env[0]!.toUpperCase() + parsed.data.env.slice(1),
    },
    select: { id: true, slug: true, deletedAt: true },
  });
  if (environment.deletedAt) {
    return apiError('Environment is soft-deleted. Restore it before pushing again.', 409);
  }

  // Next monotonic version number.
  const last = await prisma.envFileVersion.findFirst({
    where: { environmentId: environment.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const versionNumber = (last?.version ?? 0) + 1;
  const r2Key = buildVersionKey({
    workspaceId: project.workspaceId,
    projectId: project.id,
    environmentId: environment.id,
    version: versionNumber,
  });

  // Version row's creator is always a real user — for token-auth pushes we
  // record the admin who minted the token, and the "via CI" signal lives on
  // the audit row (workspaceTokenId).
  const createdByUserId =
    auth.kind === 'user' ? auth.user.id : auth.token.createdByUserId;
  const created = await prisma.envFileVersion.create({
    data: {
      environmentId: environment.id,
      version: versionNumber,
      r2Key,
      ciphertextSize: parsed.data.ciphertextSize,
      ciphertextSha256: hexToBytes(parsed.data.ciphertextSha256),
      recipientsHash: hexToBytes(parsed.data.recipientsHash),
      comment: parsed.data.comment ?? null,
      createdByUserId,
    },
    select: { id: true, version: true },
  });

  let presigned;
  try {
    presigned = await presignPut(r2Key, { sizeBytes: parsed.data.ciphertextSize });
  } catch (err) {
    if (err instanceof R2NotConfiguredError) return apiError(err.message, 503);
    throw err;
  }

  await recordAudit({
    workspaceId: project.workspaceId,
    ...auditFieldsFor(auth),
    action: 'environment.create',
    resourceType: 'envFileVersion',
    resourceId: created.id,
    metadata: {
      env: environment.slug,
      version: created.version,
      ciphertextSize: parsed.data.ciphertextSize,
      via: auth.kind === 'workspace-token' ? 'workspace-token' : 'cli',
    },
  });

  return Response.json({
    versionId: created.id,
    version: created.version,
    environmentSlug: environment.slug,
    // Surfaced so the CLI can display "me/<project>" for personal workspaces
    // instead of the auto-generated DB slug (typically the email local-part).
    workspaceType: project.workspace.type,
    uploadUrl: presigned.url,
    requiredHeaders: presigned.requiredHeaders,
    expiresIn: presigned.expiresIn,
  });
}
