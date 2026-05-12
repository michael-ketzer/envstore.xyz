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
  formData: FormData,
): Promise<CliApprovalState> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'You must be signed in.', approved: false };
  const normalized = normalizeUserCode(userCode);

  // RFC 8628-style user-presence check. The URL we arrived from carries
  // the code, which means a phishing link can pre-fill it for a confused
  // user. Requiring the user to re-type the same code their CLI printed
  // forces a deliberate "I am actually at my terminal" action — a
  // phishing email would have to also walk them through typing it, which
  // is much harder to disguise than a single Approve click.
  const confirmRaw = formData.get('confirmCode');
  const confirm = typeof confirmRaw === 'string' ? normalizeUserCode(confirmRaw) : '';
  if (confirm.length === 0) {
    return {
      error: 'Type the code from your terminal to confirm.',
      approved: false,
    };
  }
  if (confirm !== normalized) {
    return {
      error: "That code doesn't match the one in the URL. If you didn't start this from your terminal, click Deny.",
      approved: false,
    };
  }

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
