import 'server-only';
import { randomBytes } from 'node:crypto';

import { prisma } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';
import { DEFAULTS, type WorkspaceRole } from '@envstore/shared';

import { env } from '@/env';
import { sendInviteEmail } from './email';

// 32 bytes → base64url ≈ 43 chars. Plenty of entropy, URL-safe.
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export type CreateInviteResult =
  | { ok: true; invite: { id: string; email: string; acceptUrl: string } }
  | { ok: false; reason: 'already-member' | 'pending-exists'; message: string };

export async function createInvite(opts: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  invitedByUserId: string;
  inviterName: string;
  email: string;
  role: WorkspaceRole;
}): Promise<CreateInviteResult> {
  const email = opts.email.toLowerCase().trim();

  // Already a member?
  const existingMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId: opts.workspaceId, user: { email } },
  });
  if (existingMember) {
    return {
      ok: false,
      reason: 'already-member',
      message: 'That email already belongs to a member of this workspace.',
    };
  }

  // Already invited and pending?
  const pending = await prisma.invite.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (pending) {
    return {
      ok: false,
      reason: 'pending-exists',
      message: 'An invite for that email is already pending.',
    };
  }

  const token = generateInviteToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + DEFAULTS.inviteExpiryDays * 24 * 60 * 60 * 1000);

  const invite = await prisma.invite.create({
    data: {
      workspaceId: opts.workspaceId,
      email,
      role: opts.role,
      tokenHash,
      invitedByUserId: opts.invitedByUserId,
      expiresAt,
    },
    select: { id: true, email: true },
  });

  // The plaintext token is sent via email — never stored.
  const appUrl = env.AUTH_URL ?? 'http://localhost:3000';
  const acceptUrl = `${appUrl}/invite/${token}`;
  await sendInviteEmail({
    to: email,
    workspaceName: opts.workspaceName,
    inviterName: opts.inviterName,
    acceptUrl,
  });

  return { ok: true, invite: { ...invite, acceptUrl } };
}

export type AcceptInviteResult =
  | { ok: true; workspaceSlug: string }
  | {
      ok: false;
      reason: 'not-found' | 'expired' | 'accepted' | 'email-mismatch';
      message: string;
    };

export async function acceptInviteByToken(opts: {
  token: string;
  userId: string;
  userEmail: string;
}): Promise<AcceptInviteResult> {
  const tokenHash = await sha256Hex(opts.token);
  const invite = await prisma.invite.findUnique({
    where: { tokenHash },
    include: { workspace: { select: { id: true, slug: true } } },
  });
  if (!invite) return { ok: false, reason: 'not-found', message: 'Invite not found.' };
  if (invite.acceptedAt) {
    return { ok: false, reason: 'accepted', message: 'This invite has already been used.' };
  }
  if (invite.expiresAt < new Date()) {
    return { ok: false, reason: 'expired', message: 'This invite has expired.' };
  }
  if (invite.email.toLowerCase() !== opts.userEmail.toLowerCase()) {
    return {
      ok: false,
      reason: 'email-mismatch',
      message: `This invite was sent to ${invite.email}. Sign in with that email to accept.`,
    };
  }

  // Idempotent membership add — if they're already a member somehow, skip.
  const alreadyMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: opts.userId } },
  });
  if (!alreadyMember) {
    await prisma.workspaceMember.create({
      data: {
        workspaceId: invite.workspaceId,
        userId: opts.userId,
        role: invite.role,
      },
    });
  }
  await prisma.invite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });

  return { ok: true, workspaceSlug: invite.workspace.slug };
}
