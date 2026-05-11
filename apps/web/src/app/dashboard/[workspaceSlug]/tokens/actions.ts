'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';
import { revokeWorkspaceToken } from '@/lib/workspace-tokens';

export type TokenActionState = { ok: boolean; error: string | null };

export async function revokeTokenAction(
  workspaceSlug: string,
  tokenId: string,
  _: TokenActionState,
  _formData: FormData,
): Promise<TokenActionState> {
  const session = await requireSession();
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) {
    return { ok: false, error: 'Only admins and owners can revoke workspace tokens.' };
  }
  const result = await revokeWorkspaceToken(membership.workspaceId, tokenId);
  if (!result.ok) return { ok: false, error: 'Token not found.' };
  await recordAudit({
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    action: 'workspaceToken.revoke',
    resourceType: 'workspaceToken',
    resourceId: tokenId,
  });
  revalidatePath(`/dashboard/${workspaceSlug}/tokens`);
  return { ok: true, error: null };
}
