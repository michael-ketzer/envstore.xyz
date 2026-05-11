import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { WorkspaceRole } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { getProjectForUser } from '@/lib/projects';
import { hasAtLeastRole } from '@/lib/workspace-roles';
import { DeleteProject } from './delete-project';
import { ProjectSettingsForm } from './project-settings-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug, projectSlug } = await params;
  return { title: `Settings — ${workspaceSlug}/${projectSlug} — envstore` };
}

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug, projectSlug } = await params;
  const project = await getProjectForUser(workspaceSlug, projectSlug, session.user.id, {
    workspace: {
      include: {
        members: { where: { userId: session.user.id }, select: { role: true } },
      },
    },
  });
  if (!project) notFound();
  const myRole = project.workspace.members[0]?.role as WorkspaceRole | undefined;
  const canDelete = myRole !== undefined && hasAtLeastRole(myRole, 'ADMIN');

  return (
    <div className="space-y-12">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {workspaceSlug}
          </Link>
          <span className="px-1">/</span>
          <Link
            href={`/dashboard/${workspaceSlug}/${projectSlug}`}
            className="hover:text-foreground"
          >
            {projectSlug}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">settings</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Project settings</h1>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">General</h2>
        <ProjectSettingsForm
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          defaultName={project.name}
          defaultDescription={project.description ?? ''}
        />
      </section>

      {canDelete ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-5">
            <DeleteProject
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              retentionDays={project.workspace.softDeleteRetentionDays}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
