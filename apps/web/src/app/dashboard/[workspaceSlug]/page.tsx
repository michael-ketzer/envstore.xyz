import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlertCircle, ChevronRight, Folder } from 'lucide-react';

import { buttonVariants } from '@envstore/ui';
import { PERSONAL_WORKSPACE_URL_SLUG } from '@envstore/shared';

import { CodeBlock } from '@/components/code-block';
import { requireSession } from '@/lib/auth-helpers';
import { computeRekeyStatus } from '@/lib/rekey-status';
import { getWorkspaceForUser } from '@/lib/workspaces';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `${workspaceSlug} — envstore` };
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {
    projects: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { environments: true } },
        group: { select: { slug: true, name: true } },
      },
    },
    projectGroups: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { projects: { where: { deletedAt: null } } } },
      },
    },
    subscription: true,
    _count: { select: { members: true } },
  });
  if (!ws) notFound();

  const urlSlug = workspaceSlug;
  const isPersonal = ws.type === 'PERSONAL';
  const rekeyStatus = await computeRekeyStatus(ws.id);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← All workspaces
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{ws.name}</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {ws.type.toLowerCase()}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            envstore.xyz/<span className="text-foreground">{urlSlug}</span>
          </p>
          {ws.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{ws.description}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {!isPersonal ? (
            <Link
              href={`/dashboard/${urlSlug}/members`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Members
            </Link>
          ) : null}
          <Link
            href={`/dashboard/${urlSlug}/billing`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Billing
          </Link>
          <Link
            href={`/dashboard/${urlSlug}/tokens`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Tokens
          </Link>
          <Link
            href={`/dashboard/${urlSlug}/audit`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Audit
          </Link>
          <Link
            href={`/dashboard/${urlSlug}/settings`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Settings
          </Link>
          <Link
            href={`/dashboard/${urlSlug}/groups/new`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            New group
          </Link>
          <Link
            href={`/dashboard/${urlSlug}/new`}
            className={buttonVariants({ size: 'sm' })}
          >
            New project
          </Link>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {!isPersonal ? <Stat label="Members" value={ws._count.members} /> : null}
        <Stat label="Projects" value={ws.projects.length} />
        <Stat
          label="Billing"
          href={`/dashboard/${urlSlug}/billing`}
          value={
            ws.subscription?.status === 'TRIALING' && ws.subscription.trialEndsAt
              ? `Trial until ${ws.subscription.trialEndsAt.toLocaleDateString()}`
              : (ws.subscription?.status?.toLowerCase() ?? '—')
          }
        />
        <Stat label="Soft-delete window" value={`${ws.softDeleteRetentionDays}d`} />
      </dl>

      {rekeyStatus.staleCount > 0 ? (
        <RekeyBanner staleCount={rekeyStatus.staleCount} workspaceSlug={urlSlug} />
      ) : null}

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Projects</h2>
        </div>

        {ws.projects.length === 0 && ws.projectGroups.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-10 text-center">
            <p className="text-sm text-muted-foreground">No projects yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A project usually maps to a single app or repo. It holds one or more environments
              (production, staging…), each with its own encrypted .env history.
            </p>
            <Link
              href={`/dashboard/${urlSlug}/new`}
              className={`${buttonVariants({ size: 'sm' })} mt-6`}
            >
              Create your first project
            </Link>
          </div>
        ) : (
          <ProjectListing
            workspaceSlug={urlSlug}
            projects={ws.projects.map((p) => ({
              id: p.id,
              slug: p.slug,
              name: p.name,
              groupSlug: p.group?.slug ?? null,
              environmentCount: p._count.environments,
            }))}
            groups={ws.projectGroups.map((g) => ({
              slug: g.slug,
              name: g.name,
              description: g.description,
              projectCount: g._count.projects,
            }))}
          />
        )}
      </section>

      {urlSlug !== PERSONAL_WORKSPACE_URL_SLUG && isPersonal ? (
        <p className="text-xs text-muted-foreground">
          Tip: visit <Link href={`/dashboard/${PERSONAL_WORKSPACE_URL_SLUG}`} className="underline">/dashboard/me</Link> as a stable URL for your personal workspace.
        </p>
      ) : null}
    </div>
  );
}

type ProjectListItem = {
  id: string;
  slug: string;
  name: string;
  groupSlug: string | null;
  environmentCount: number;
};

type GroupListItem = {
  slug: string;
  name: string;
  description: string | null;
  projectCount: number;
};

function ProjectListing({
  workspaceSlug,
  projects,
  groups,
}: {
  workspaceSlug: string;
  projects: ProjectListItem[];
  groups: GroupListItem[];
}) {
  const standalone = projects.filter((p) => p.groupSlug === null);
  const byGroup = new Map<string, ProjectListItem[]>();
  for (const p of projects) {
    if (!p.groupSlug) continue;
    const bucket = byGroup.get(p.groupSlug) ?? [];
    bucket.push(p);
    byGroup.set(p.groupSlug, bucket);
  }

  // Empty groups still render (so users can see them and add projects).
  return (
    <div className="mt-4 space-y-6">
      {groups.map((g) => (
        <GroupCard
          key={g.slug}
          workspaceSlug={workspaceSlug}
          group={g}
          projects={byGroup.get(g.slug) ?? []}
        />
      ))}
      {standalone.length > 0 ? (
        <div className="space-y-2">
          {groups.length > 0 ? (
            <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Standalone
            </h3>
          ) : null}
          <ProjectList workspaceSlug={workspaceSlug} items={standalone} />
        </div>
      ) : null}
    </div>
  );
}

function GroupCard({
  workspaceSlug,
  group,
  projects,
}: {
  workspaceSlug: string;
  group: GroupListItem;
  projects: ProjectListItem[];
}) {
  // <details> handles open/close natively (no React state needed). The chevron
  // rotates 90° via the group-open: variant; the rest of the row keeps its
  // layout regardless of state.
  return (
    <details
      open
      className="group/details overflow-hidden rounded-lg border border-border bg-muted/20"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 border-b border-border bg-muted/40 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90"
        />
        <Folder aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/${workspaceSlug}/groups/${group.slug}`}
            className="text-base font-semibold hover:underline"
          >
            {group.name}
          </Link>
          {group.description ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{group.description}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {group.projectCount} {group.projectCount === 1 ? 'project' : 'projects'}
        </span>
      </summary>
      {projects.length > 0 ? (
        <ul className="divide-y divide-border bg-background">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/${workspaceSlug}/${p.slug}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/30"
              >
                <div className="min-w-0 font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.environmentCount}{' '}
                  {p.environmentCount === 1 ? 'environment' : 'environments'}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="bg-background px-5 py-6 text-center">
          <p className="text-xs text-muted-foreground">No projects in this group yet.</p>
          <Link
            href={`/dashboard/${workspaceSlug}/new?group=${encodeURIComponent(group.slug)}`}
            className="mt-2 inline-block text-xs text-foreground underline"
          >
            Add a project →
          </Link>
        </div>
      )}
    </details>
  );
}

function ProjectList({
  workspaceSlug,
  items,
}: {
  workspaceSlug: string;
  items: ProjectListItem[];
}) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((p) => (
        <li key={p.id}>
          <Link
            href={`/dashboard/${workspaceSlug}/${p.slug}`}
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/30"
          >
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-muted-foreground">
              {p.environmentCount}{' '}
              {p.environmentCount === 1 ? 'environment' : 'environments'}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RekeyBanner({
  staleCount,
  workspaceSlug: _workspaceSlug,
}: {
  staleCount: number;
  workspaceSlug: string;
}) {
  return (
    <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-5">
      <div className="flex items-start gap-3">
        <AlertCircle
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-yellow-700 dark:text-yellow-300"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {staleCount} env version{staleCount === 1 ? '' : 's'} encrypted to an out-of-date
            recipient set.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Someone joined, left, or rotated keys — existing ciphertext is still only readable
            by yesterday's recipients. From a repo with this workspace's{' '}
            <code className="font-mono">envstore.json</code>, run:
          </p>
          <div className="mt-3">
            <CodeBlock code="envstore rekey" label="Copy rekey command" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-sm font-medium text-foreground">{value}</dd>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-md border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-md border border-border p-4">{body}</div>;
}
