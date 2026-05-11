import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { buttonVariants } from '@envstore/ui';
import { PERSONAL_WORKSPACE_URL_SLUG } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
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
      include: { _count: { select: { environments: true } } },
    },
    subscription: true,
    _count: { select: { members: true } },
  });
  if (!ws) notFound();

  // The slug used in URLs. For personal workspaces hitting /dashboard/me, this
  // is "me" — keeps the user's URL stable even though the DB slug is different.
  const urlSlug = workspaceSlug;
  const isPersonal = ws.type === 'PERSONAL';

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
            href={`/dashboard/${urlSlug}/settings`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Settings
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
            isPersonal
              ? 'Free'
              : ws.subscription?.status === 'TRIALING' && ws.subscription.trialEndsAt
                ? `Trial until ${ws.subscription.trialEndsAt.toLocaleDateString()}`
                : (ws.subscription?.status?.toLowerCase() ?? '—')
          }
        />
        <Stat label="Soft-delete window" value={`${ws.softDeleteRetentionDays}d`} />
      </dl>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Projects</h2>
        </div>

        {ws.projects.length === 0 ? (
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
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {ws.projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/dashboard/${urlSlug}/${p.slug}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/30"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.slug}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p._count.environments}{' '}
                    {p._count.environments === 1 ? 'environment' : 'environments'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
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
