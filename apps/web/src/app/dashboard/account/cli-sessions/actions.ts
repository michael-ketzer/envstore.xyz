'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { revokeCliToken } from '@/lib/cli-tokens';

export type RevokeState = { error: string | null };

export async function revokeCliTokenAction(
  tokenId: string,
  _: RevokeState,
  __: FormData,
): Promise<RevokeState> {
  const session = await requireSession();
  const ok = await revokeCliToken(tokenId, session.user.id);
  if (!ok) return { error: 'Token not found.' };
  await recordAudit({
    userId: session.user.id,
    action: 'cli-token.revoke',
    resourceType: 'cliToken',
    resourceId: tokenId,
    metadata: { via: 'web' },
  });
  revalidatePath('/dashboard/account/cli-sessions');
  return { error: null };
}
