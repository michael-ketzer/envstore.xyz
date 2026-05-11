import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { WorkspaceRole } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';
import { hasAtLeastRole } from '@/lib/workspace-roles';
import { InviteForm } from './invite-form';
import {
  RemoveMemberButton,
  RevokeInviteButton,
  RoleSelect,
} from './member-row-actions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `Members — ${workspaceSlug} — envstore` };
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {
    members: {
      include: { user: { select: { id: true, email: true, name: true, image: true } } },
      orderBy: { joinedAt: 'asc' },
    },
    invites: {
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { invitedBy: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    },
  });
  if (!ws) notFound();
  // Members page doesn't apply to personal workspaces — they're single-member by definition.
  if (ws.type === 'PERSONAL') notFound();

  const urlSlug = workspaceSlug;
  const myMember = ws.members.find((m) => m.userId === session.user.id);
  const myRole = myMember?.role as WorkspaceRole | undefined;
  const canInvite = myRole !== undefined && hasAtLeastRole(myRole, 'ADMIN');
  const canRemove = canInvite;
  const isOwner = myRole === 'OWNER';

  return (
    <div className="space-y-12">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${urlSlug}`} className="hover:text-foreground">
            {urlSlug}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">members</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Members</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Anyone in this workspace can push and pull encrypted files for any of its projects.
          Invite unlimited people; you pay one $1.99/month for the whole workspace.
        </p>
      </header>

      {canInvite ? (
        <section>
          <h2 className="text-lg font-semibold">Invite</h2>
          <div className="mt-4">
            <InviteForm workspaceSlug={urlSlug} canInviteAdmins={isOwner} />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">
          Members <span className="text-muted-foreground">({ws.members.length})</span>
        </h2>
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {ws.members.map((m) => {
            const isSelf = m.userId === session.user.id;
            const editableRole = isOwner && !isSelf && m.role !== 'OWNER';
            const removable = canRemove && !isSelf && m.role !== 'OWNER';
            return (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.user.name ?? m.user.email}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {m.user.email}
                    {isSelf ? ' (you)' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {editableRole ? (
                    <RoleSelect
                      workspaceSlug={urlSlug}
                      userId={m.userId}
                      currentRole={m.role as 'ADMIN' | 'MEMBER'}
                    />
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {m.role.toLowerCase()}
                    </span>
                  )}
                  {removable ? (
                    <RemoveMemberButton workspaceSlug={urlSlug} userId={m.userId} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {ws.invites.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold">
            Pending invites <span className="text-muted-foreground">({ws.invites.length})</span>
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {ws.invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Invited by {inv.invitedBy.name ?? inv.invitedBy.email} as{' '}
                    {inv.role.toLowerCase()}. Expires{' '}
                    {inv.expiresAt.toLocaleDateString()}.
                  </div>
                </div>
                {canInvite ? (
                  <RevokeInviteButton workspaceSlug={urlSlug} inviteId={inv.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
