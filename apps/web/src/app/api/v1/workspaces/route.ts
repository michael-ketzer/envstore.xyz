import { workspaceCreateSchema } from '@envstore/shared';

import { apiError, authenticateBearer, requireUserAuth, unauthorized } from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { createTeamWorkspace } from '@/lib/workspaces';

export async function POST(req: Request) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = workspaceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  const result = await createTeamWorkspace(userAuth.user.id, parsed.data);
  if (!result.ok) {
    const status = result.reason === 'slug-taken' ? 409 : 400;
    return apiError(result.message, status);
  }

  await recordAudit({
    workspaceId: result.workspace.id,
    userId: userAuth.user.id,
    action: 'workspace.create',
    resourceType: 'workspace',
    resourceId: result.workspace.id,
    metadata: { via: 'cli' },
  });

  return Response.json(
    { slug: result.workspace.slug, name: parsed.data.name, type: 'TEAM', role: 'OWNER' },
    { status: 201 },
  );
}
