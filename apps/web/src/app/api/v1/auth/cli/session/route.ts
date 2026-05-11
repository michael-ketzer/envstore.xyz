// DELETE /api/v1/auth/cli/session — revoke the current CLI token.
// Used by `envstore logout`. Idempotent.

import { prisma } from '@envstore/db';

import { authenticateBearer, unauthorized } from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';

export async function DELETE(req: Request) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  await prisma.cliToken.delete({ where: { id: auth.cliToken.id } });
  await recordAudit({
    userId: auth.user.id,
    action: 'cli-token.revoke',
    resourceType: 'cliToken',
    resourceId: auth.cliToken.id,
    metadata: { via: 'cli' },
  });
  return new Response(null, { status: 204 });
}
