import 'server-only';
import { notFound } from 'next/navigation';

import { prisma, type Prisma, type Workspace, type WorkspaceMember } from '@envstore/db';
import { PERSONAL_WORKSPACE_URL_SLUG, type WorkspaceRole } from '@envstore/shared';

const roleRank: Record<WorkspaceRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function hasAtLeastRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export type Membership = WorkspaceMember & { workspace: Workspace };

// Build the membership-where clause, treating the magic slug "me" as the
// current user's personal workspace.
function membershipWhere(slug: string, userId: string): Prisma.WorkspaceMemberWhereInput {
  return slug === PERSONAL_WORKSPACE_URL_SLUG
    ? {
        userId,
        workspace: { ownerId: userId, type: 'PERSONAL', deletedAt: null },
      }
    : { userId, workspace: { slug, deletedAt: null } };
}

// Membership gate. Non-members see 404 — we don't leak workspace existence.
// Returns the membership row plus the workspace so callers don't refetch.
export async function requireWorkspaceMembership(
  slug: string,
  userId: string,
): Promise<Membership> {
  const member = await prisma.workspaceMember.findFirst({
    where: membershipWhere(slug, userId),
    include: { workspace: true },
  });
  if (!member) notFound();
  return member;
}

// For role-gated mutations: returns null if the membership is below `required`,
// otherwise the membership. Callers translate the null into a user-facing error
// (so we don't trigger Next's full-page error UI for a normal permission case).
export async function getWorkspaceMembershipWithRole(
  slug: string,
  userId: string,
  required: WorkspaceRole,
): Promise<Membership | null> {
  const member = await prisma.workspaceMember.findFirst({
    where: membershipWhere(slug, userId),
    include: { workspace: true },
  });
  if (!member) return null;
  if (!hasAtLeastRole(member.role as WorkspaceRole, required)) return null;
  return member;
}
