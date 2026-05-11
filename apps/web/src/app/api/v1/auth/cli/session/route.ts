// DELETE /api/v1/auth/cli/session — revoke the current CLI token.
// Used by `envstore logout`. Idempotent.

import { prisma } from '@envstore/db';

import { authenticateBearer, requireUserAuth, unauthorized } from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';

export async function DELETE(req: Request) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;
  await prisma.cliToken.delete({ where: { id: userAuth.cliToken.id } });
  await recordAudit({
    userId: userAuth.user.id,
    action: 'cli-token.revoke',
    resourceType: 'cliToken',
    resourceId: userAuth.cliToken.id,
    metadata: { via: 'cli' },
  });
  return new Response(null, { status: 204 });
}
