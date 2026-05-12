// POST /api/v1/workspaces/[ws]/projects/[proj]/environments/[env]/current
//
// Body: { versionId } OR { version }.  Atomically flips
// Environment.currentVersionId to the named version, making future pulls
// return it. This is the "rollback" operation surfaced by the CLI's
// `envstore rollback` command and the dashboard's history drawer.
//
// Auth: workspace member OR workspace-scoped service token whose project
// allowlist covers this project. Service tokens CAN roll back (it's a
// CI-relevant operation), but billing-write access is required —
// rollback is a write at the audit-log level and changes the env's
// effective state.

import { prisma } from '@envstore/db';
import {
  environmentSlugSchema,
  versionRollbackSchema,
} from '@envstore/shared';

import {
  apiError,
  auditFieldsFor,
  authenticateBearer,
  notFound,
  resolveWorkspaceForAuth,
  tokenAllowsProject,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import {
  WorkspaceAccessDeniedError,
  requireWorkspaceWrite,
} from '@/lib/billing';

type Ctx = {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    envSlug: string;
  }>;
};

export async function POST(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const { workspaceSlug, projectSlug, envSlug } = await ctx.params;

  const slugCheck = environmentSlugSchema.safeParse(envSlug);
  if (!slugCheck.success) {
    return apiError(slugCheck.error.issues[0]?.message ?? 'Invalid env slug.', 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = versionRollbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid body.', 400);
  }

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
  if (!tokenAllowsProject(auth, project.id)) {
    return apiError('Service token is not scoped to this project.', 403);
  }

  try {
    requireWorkspaceWrite(project.workspace);
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

  // Resolve the target version. Schema-level refine guarantees exactly
  // one of {versionId, version} is present; both lookups scope to THIS
  // environment so a cross-env id (or a version number that exists in a
  // different env with the same int) can't be hit.
  const target = parsed.data.versionId
    ? await prisma.envFileVersion.findFirst({
        where: { id: parsed.data.versionId, environmentId: environment.id },
        select: { id: true, version: true },
      })
    : await prisma.envFileVersion.findUnique({
        where: {
          environmentId_version: {
            environmentId: environment.id,
            version: parsed.data.version!,
          },
        },
        select: { id: true, version: true },
      });
  if (!target) return notFound('Version not found.');

  // No-op when the target IS already current. Return 200 with a flag so
  // CLI / UI can show "already at that version" instead of re-rendering
  // as if a change happened.
  if (environment.currentVersionId === target.id) {
    return Response.json({
      ok: true,
      noop: true,
      versionId: target.id,
      version: target.version,
      environmentSlug: environment.slug,
    });
  }

  // We capture the previous pointer for audit so an admin can see the
  // exact step that was undone, then flip the pointer.
  const previousVersionId = environment.currentVersionId;
  await prisma.environment.update({
    where: { id: environment.id },
    data: { currentVersionId: target.id },
  });

  await recordAudit({
    workspaceId: project.workspaceId,
    ...auditFieldsFor(auth),
    action: 'environment.update',
    resourceType: 'environment',
    resourceId: environment.id,
    metadata: {
      env: environment.slug,
      rolledBackTo: target.version,
      previousVersionId: previousVersionId ?? null,
      via: auth.kind === 'workspace-token' ? 'workspace-token' : 'cli',
    },
  });

  return Response.json({
    ok: true,
    noop: false,
    versionId: target.id,
    version: target.version,
    environmentSlug: environment.slug,
  });
}
