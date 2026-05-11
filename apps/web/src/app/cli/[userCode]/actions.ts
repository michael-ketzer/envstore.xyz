'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import {
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  normalizeUserCode,
} from '@/lib/device-auth';

export type CliApprovalState = { error: string | null; approved: boolean };

export async function approveAction(
  userCode: string,
  _: CliApprovalState,
  __: FormData,
): Promise<CliApprovalState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'You must be signed in.', approved: false };
  const normalized = normalizeUserCode(userCode);
  const result = await approveDeviceAuthorization({
    userCode: normalized,
    userId: session.user.id,
  });
  if (!result.ok) {
    const message = {
      'not-found': 'That code is invalid.',
      expired: 'That code has expired.',
      'already-approved': 'That request was already handled.',
      denied: 'That request was already denied.',
    }[result.reason];
    return { error: message, approved: false };
  }
  await recordAudit({
    userId: session.user.id,
    action: 'cli-token.create',
    resourceType: 'deviceAuthorization',
    resourceId: normalized,
    metadata: { via: 'web-approval' },
  });
  revalidatePath(`/cli/${normalized}`);
  return { error: null, approved: true };
}

export async function denyAction(
  userCode: string,
  _: CliApprovalState,
  __: FormData,
): Promise<CliApprovalState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'You must be signed in.', approved: false };
  const normalized = normalizeUserCode(userCode);
  await denyDeviceAuthorization({ userCode: normalized });
  revalidatePath(`/cli/${normalized}`);
  return { error: null, approved: false };
}
