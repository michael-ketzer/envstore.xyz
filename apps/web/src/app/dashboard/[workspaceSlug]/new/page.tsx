import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';

import { NewProjectForm } from './new-project-form';

export const metadata: Metadata = {
  title: 'New project — envstore',
};

export default async function NewProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const { group: preselectedGroup } = await searchParams;
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {
    projectGroups: {
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { slug: true, name: true },
    },
  });
  if (!ws) notFound();

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link
          href={`/dashboard/${workspaceSlug}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to {workspaceSlug}
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">New project</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Usually one project per app or repo. Each project holds one or more environments
          (production, staging, dev…), and each environment has its own encrypted version history.
        </p>
      </div>
      <NewProjectForm
        workspaceSlug={workspaceSlug}
        groups={ws.projectGroups}
        defaultGroupSlug={preselectedGroup ?? null}
      />
    </div>
  );
}
