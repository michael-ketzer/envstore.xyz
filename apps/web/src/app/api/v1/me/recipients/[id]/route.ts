// DELETE /api/v1/me/recipients/[id] — revoke one of the caller's recipients.
//
// Hard-deletes the row so the recipient is excluded from every future push's
// encrypt-set. Historical ciphertext stays decryptable by anyone holding the
// matching private key (we can't claw back already-distributed data); the
// recipient-set mismatch surfaces the env versions as stale on the workspace
// home and prompts the owner to run `envstore rekey`, which re-encrypts
// against the now-pruned recipient list.

import { prisma } from '@envstore/db';

import {
  authenticateBearer,
  notFound,
  requireUserAuth,
  unauthorized,
} from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;

  const { id } = await ctx.params;

  // Scope the lookup by userId so callers can't probe another user's
  // recipient IDs (the 404 then doesn't leak existence).
  const existing = await prisma.userRecipient.findFirst({
    where: { id, userId: userAuth.user.id },
    select: { id: true, recipient: true, kind: true, label: true },
  });
  if (!existing) return notFound('Recipient not found.');

  await prisma.userRecipient.delete({ where: { id: existing.id } });
  await recordAudit({
    userId: userAuth.user.id,
    action: 'recipient.revoke',
    resourceType: 'recipient',
    resourceId: existing.id,
    metadata: {
      kind: existing.kind,
      label: existing.label,
      recipient: existing.recipient,
      via: 'cli',
    },
  });
  return Response.json({ ok: true });
}
