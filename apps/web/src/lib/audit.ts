import 'server-only';
import { headers } from 'next/headers';

import { prisma, type Prisma } from '@envstore/db';

export type AuditAction =
  // Workspace
  | 'workspace.create'
  | 'workspace.update'
  | 'workspace.soft-delete'
  | 'workspace.restore'
  // Project
  | 'project.create'
  | 'project.update'
  | 'project.soft-delete'
  // Project groups
  | 'projectGroup.create'
  | 'projectGroup.update'
  | 'projectGroup.soft-delete'
  // Environment
  | 'environment.create'
  | 'environment.update'
  | 'environment.soft-delete'
  // Members + invites
  | 'invite.create'
  | 'invite.accept'
  | 'invite.revoke'
  | 'member.remove'
  | 'member.role-change'
  // Auth / identity (web side — CLI logs separately)
  | 'recipient.register'
  | 'recipient.revoke'
  | 'cli-token.create'
  | 'cli-token.revoke'
  // Workspace service tokens (CI/CD)
  | 'workspaceToken.create'
  | 'workspaceToken.revoke'
  // Billing — webhook-driven and user-initiated
  | 'billing.subscription.created'
  | 'billing.subscription.activated'
  | 'billing.subscription.trialing'
  | 'billing.subscription.updated'
  | 'billing.subscription.past_due'
  | 'billing.subscription.paused'
  | 'billing.subscription.resumed'
  | 'billing.subscription.canceled'
  | 'billing.cancel_requested';

export type RecordAuditInput = {
  workspaceId?: string | null;
  userId?: string | null;
  // Populated when a service token authenticated the request instead of a
  // user. Set both `workspaceTokenId` and (optionally) the original
  // `createdByUserId` of the token in metadata if you want both signals.
  workspaceTokenId?: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const h = await headers();
  const ipForwarded = h.get('x-forwarded-for');
  const ipAddress =
    ipForwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
  const userAgent = h.get('user-agent') ?? null;

  await prisma.auditLog.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      workspaceTokenId: input.workspaceTokenId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      ipAddress,
      userAgent,
      metadata:
        input.metadata === undefined
          ? undefined
          : (input.metadata as Prisma.InputJsonValue),
    },
  });
}
