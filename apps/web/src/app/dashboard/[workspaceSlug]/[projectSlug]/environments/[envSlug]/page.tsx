// Environment version-history page. Lists every retained version
// (newest-first), marks the current one, and lets workspace members
// roll back to any prior version via a button.
//
// Cap is per-workspace (`Workspace.versionHistoryLimit`). Older versions
// have already been pruned by the inline sweep at finalize-time.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@envstore/db';
import { buttonVariants } from '@envstore/ui';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';

import { RollbackButton } from './rollback-button';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string; envSlug: string }>;
}): Promise<Metadata> {
  const { projectSlug, envSlug } = await params;
  return {
    title: `${projectSlug}/${envSlug} history — envstore`,
  };
}

export default async function EnvironmentHistoryPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string; envSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug, projectSlug, envSlug } = await params;

  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id);
  if (!ws) notFound();

  const project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, deletedAt: null },
    select: { id: true, slug: true, name: true },
  });
  if (!project) notFound();

  const environment = await prisma.environment.findFirst({
    where: { projectId: project.id, slug: envSlug, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      currentVersionId: true,
      versions: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          ciphertextSize: true,
          comment: true,
          createdAt: true,
          createdBy: { select: { email: true } },
        },
      },
    },
  });
  if (!environment) notFound();

  const versionHistoryLimit = ws.versionHistoryLimit;
  const visible = environment.versions.length;
  // Caveat surfaced under the header: "showing N of cap M".
  const atCap = visible >= versionHistoryLimit;

  return (
    <div className="space-y-8">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {workspaceSlug}
          </Link>
          <span className="px-1">/</span>
          <Link
            href={`/dashboard/${workspaceSlug}/${project.slug}`}
            className="hover:text-foreground"
          >
            {project.name}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">{environment.name} history</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {environment.name} <span className="text-muted-foreground">history</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {visible} version{visible === 1 ? '' : 's'} retained.{' '}
          {atCap
            ? `At the workspace cap (${versionHistoryLimit}); older versions are pruned on every successful push.`
            : `Workspace cap: ${versionHistoryLimit}.`}{' '}
          The version marked <em>current</em> is what <code className="font-mono">envstore pull</code> returns.
        </p>
      </header>

      {environment.versions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-sm text-muted-foreground">
          No versions yet. Push from a machine with a registered identity to create the first one.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {environment.versions.map((v) => {
            const isCurrent = v.id === environment.currentVersionId;
            return (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm font-medium">v{v.version}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(v.ciphertextSize)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {v.createdAt.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    by {v.createdBy?.email ?? 'unknown'}
                    {v.comment ? (
                      <>
                        {' '}
                        ·{' '}
                        <span className="text-foreground">{v.comment}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <RollbackButton
                  workspaceSlug={workspaceSlug}
                  projectSlug={project.slug}
                  envSlug={environment.slug}
                  versionId={v.id}
                  versionNumber={v.version}
                  isCurrent={isCurrent}
                />
              </li>
            );
          })}
        </ul>
      )}

      <section className="text-sm text-muted-foreground">
        <Link
          href={`/dashboard/${workspaceSlug}/${project.slug}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          ← Back to {project.name}
        </Link>
      </section>
    </div>
  );
}
