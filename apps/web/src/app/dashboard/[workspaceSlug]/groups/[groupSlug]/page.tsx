import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Folder } from 'lucide-react';

import { buttonVariants } from '@envstore/ui';
import { defaultFilenameForEnvironment } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { getProjectGroupForUser } from '@/lib/project-groups';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; groupSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug, groupSlug } = await params;
  return { title: `${workspaceSlug}/${groupSlug} — envstore` };
}

export default async function GroupPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; groupSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug, groupSlug } = await params;
  const group = await getProjectGroupForUser(workspaceSlug, groupSlug, session.user.id, {
    workspace: { select: { name: true } },
    projects: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        environments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { slug: true, name: true },
        },
        _count: { select: { environments: true } },
      },
    },
  });
  if (!group) notFound();

  return (
    <div className="space-y-10">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground">
            workspaces
          </Link>
          <span className="px-1">/</span>
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {group.workspace.name}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">{group.name}</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Folder aria-hidden className="h-7 w-7 text-muted-foreground" />
              <h1 className="text-3xl font-semibold tracking-tight">{group.name}</h1>
            </div>
            {group.description ? (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{group.description}</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Link
              href={`/dashboard/${workspaceSlug}/groups/${group.slug}/settings`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Settings
            </Link>
            <Link
              href={`/dashboard/${workspaceSlug}/new?group=${encodeURIComponent(group.slug)}`}
              className={buttonVariants({ size: 'sm' })}
            >
              New project
            </Link>
          </div>
        </div>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Projects in this group</h2>
        {group.projects.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-10 text-center">
            <p className="text-sm text-muted-foreground">No projects in this group yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a new project here, or move an existing one from its settings page.
            </p>
            <Link
              href={`/dashboard/${workspaceSlug}/new?group=${encodeURIComponent(group.slug)}`}
              className={`${buttonVariants({ size: 'sm' })} mt-6`}
            >
              Add a project
            </Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {group.projects.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-border bg-background"
              >
                <Link
                  href={`/dashboard/${workspaceSlug}/${p.slug}`}
                  className="flex items-center justify-between border-b border-border px-5 py-3 hover:bg-muted/30"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p._count.environments}{' '}
                    {p._count.environments === 1 ? 'environment' : 'environments'} →
                  </div>
                </Link>
                {p.environments.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {p.environments.map((env) => (
                      <li
                        key={env.slug}
                        className="flex items-center justify-between px-5 py-2 text-xs"
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-foreground">{env.name}</span>
                          <code className="font-mono text-muted-foreground">{env.slug}</code>
                        </div>
                        <code className="font-mono text-muted-foreground">
                          {defaultFilenameForEnvironment(env.slug)}
                        </code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-5 py-2 text-xs italic text-muted-foreground">
                    No environments pushed yet.
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-sm text-muted-foreground">
        <Link
          href={`/dashboard/${workspaceSlug}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          ← Back to {workspaceSlug}
        </Link>
      </section>
    </div>
  );
}
