'use server';

import { revalidatePath } from 'next/cache';

import { prisma } from '@envstore/db';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';

export type RevokeRecipientState = { error: string | null };

export async function revokeRecipientAction(
  recipientId: string,
  _: RevokeRecipientState,
  __: FormData,
): Promise<RevokeRecipientState> {
  const session = await requireSession();

  // Scope-by-userId on the lookup so a forged ID for another user's recipient
  // just 404s here rather than silently deleting someone else's row.
  const existing = await prisma.userRecipient.findFirst({
    where: { id: recipientId, userId: session.user.id },
    select: { id: true, recipient: true, kind: true, label: true },
  });
  if (!existing) return { error: 'Recipient not found.' };

  await prisma.userRecipient.delete({ where: { id: existing.id } });
  await recordAudit({
    userId: session.user.id,
    action: 'recipient.revoke',
    resourceType: 'recipient',
    resourceId: existing.id,
    metadata: {
      kind: existing.kind,
      label: existing.label,
      recipient: existing.recipient,
      via: 'web',
    },
  });
  revalidatePath('/dashboard/account/recipients');
  return { error: null };
}
