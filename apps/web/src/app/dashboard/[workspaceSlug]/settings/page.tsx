import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PERSONAL_WORKSPACE_URL_SLUG, type WorkspaceRole } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';
import { hasAtLeastRole } from '@/lib/workspace-roles';
import { DangerZone } from './danger-zone';
import { WorkspaceSettingsForm } from './workspace-settings-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `Settings — ${workspaceSlug} — envstore` };
}

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {
    members: { where: { userId: session.user.id }, select: { role: true } },
  });
  if (!ws) notFound();

  const urlSlug = workspaceSlug; // stays "me" for personal
  const isPersonal = ws.type === 'PERSONAL';
  const myRole = ws.members[0]?.role as WorkspaceRole | undefined;
  const canEdit = myRole !== undefined && hasAtLeastRole(myRole, 'ADMIN');
  const canDelete = myRole === 'OWNER' && !isPersonal;

  return (
    <div className="space-y-12">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${urlSlug}`} className="hover:text-foreground">
            {urlSlug}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">settings</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Workspace settings</h1>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">General</h2>
        {canEdit ? (
          <WorkspaceSettingsForm
            workspaceSlug={urlSlug}
            defaultName={ws.name}
            defaultDescription={ws.description ?? ''}
            defaultRetention={ws.softDeleteRetentionDays}
            defaultVersionHistoryLimit={ws.versionHistoryLimit}
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Only admins and owners can change settings. Your role: {myRole?.toLowerCase()}.
          </div>
        )}
      </section>

      {isPersonal ? (
        <section className="space-y-2 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Personal workspace.</p>
          <p>
            Always addressable at{' '}
            <code className="font-mono">/dashboard/{PERSONAL_WORKSPACE_URL_SLUG}</code>. Members
            and invites are not available — personal workspaces are private to you. To
            collaborate, create a team workspace.
          </p>
        </section>
      ) : null}

      {canDelete ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-5">
            <DangerZone workspaceSlug={urlSlug} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
