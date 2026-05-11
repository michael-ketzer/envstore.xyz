'use server';

import { redirect } from 'next/navigation';

import { recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { acceptInviteByToken } from '@/lib/invites';

export type AcceptInviteState = { error: string | null };

export async function acceptInviteAction(
  token: string,
  _: AcceptInviteState,
  __: FormData,
): Promise<AcceptInviteState> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  }
  const result = await acceptInviteByToken({
    token,
    userId: session.user.id,
    userEmail: session.user.email,
  });
  if (!result.ok) return { error: result.message };

  await recordAudit({
    userId: session.user.id,
    action: 'invite.accept',
    resourceType: 'workspace',
    resourceId: result.workspaceSlug,
  });
  redirect(`/dashboard/${result.workspaceSlug}`);
}
