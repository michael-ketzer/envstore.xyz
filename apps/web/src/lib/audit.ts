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
  | 'cli-token.revoke';

export type RecordAuditInput = {
  workspaceId?: string | null;
  userId?: string | null;
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
