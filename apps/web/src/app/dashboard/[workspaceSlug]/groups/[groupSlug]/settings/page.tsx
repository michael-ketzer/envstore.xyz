import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { WorkspaceRole } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { getProjectGroupForUser } from '@/lib/project-groups';
import { hasAtLeastRole } from '@/lib/workspace-roles';

import { DeleteGroup } from './delete-group';
import { GroupSettingsForm } from './group-settings-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; groupSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug, groupSlug } = await params;
  return { title: `Settings — ${workspaceSlug}/${groupSlug} — envstore` };
}

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; groupSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug, groupSlug } = await params;
  const group = await getProjectGroupForUser(workspaceSlug, groupSlug, session.user.id, {
    workspace: {
      include: {
        members: { where: { userId: session.user.id }, select: { role: true } },
      },
    },
    _count: { select: { projects: { where: { deletedAt: null } } } },
  });
  if (!group) notFound();
  const myRole = group.workspace.members[0]?.role as WorkspaceRole | undefined;
  const canDelete = myRole !== undefined && hasAtLeastRole(myRole, 'ADMIN');

  return (
    <div className="space-y-12">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {group.workspace.name}
          </Link>
          <span className="px-1">/</span>
          <Link
            href={`/dashboard/${workspaceSlug}/groups/${groupSlug}`}
            className="hover:text-foreground"
          >
            {group.name}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">settings</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Group settings</h1>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">General</h2>
        <GroupSettingsForm
          workspaceSlug={workspaceSlug}
          groupSlug={groupSlug}
          defaultName={group.name}
          defaultDescription={group.description ?? ''}
        />
      </section>

      {canDelete ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-5">
            <DeleteGroup
              workspaceSlug={workspaceSlug}
              groupSlug={groupSlug}
              projectCount={group._count.projects}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
