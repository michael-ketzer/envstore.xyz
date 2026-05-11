import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@envstore/db';
import { buttonVariants } from '@envstore/ui';
import { PERSONAL_WORKSPACE_URL_SLUG, PRICING } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { ensurePersonalWorkspace } from '@/lib/workspaces';

export const metadata: Metadata = {
  title: 'Dashboard — envstore',
};

export default async function DashboardPage() {
  const session = await requireSession();
  await ensurePersonalWorkspace(session.user.id);

  const workspaces = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
      members: { some: { userId: session.user.id } },
    },
    include: {
      subscription: true,
      _count: { select: { members: true, projects: true } },
    },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  });

  return (
    <div className="space-y-12">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Each workspace is its own billing unit. Personal workspaces are private to you; team
            workspaces can have unlimited members. $
            {(PRICING.monthlyCents / 100).toFixed(2)}/month each, after a{' '}
            {PRICING.trialDays}-day trial.
          </p>
        </div>
        <Link href="/dashboard/new" className={buttonVariants({ size: 'sm' })}>
          New workspace
        </Link>
      </section>

      <section>
        <div className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((ws) => {
            const isPersonal = ws.type === 'PERSONAL';
            const urlSlug = isPersonal ? PERSONAL_WORKSPACE_URL_SLUG : ws.slug;
            return (
              <Link
                key={ws.id}
                href={`/dashboard/${urlSlug}`}
                className="block rounded-md border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-medium">{ws.name}</h2>
                    <p className="font-mono text-xs text-muted-foreground">{urlSlug}</p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {ws.type.toLowerCase()}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {!isPersonal ? (
                    <div>
                      <dt>Members</dt>
                      <dd className="text-foreground">{ws._count.members}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Projects</dt>
                    <dd className="text-foreground">{ws._count.projects}</dd>
                  </div>
                  <div className={isPersonal ? '' : 'col-span-2'}>
                    <dt>Billing</dt>
                    <dd className="text-foreground">
                      {ws.subscription?.status === 'TRIALING' && ws.subscription.trialEndsAt
                        ? `Trial ends ${ws.subscription.trialEndsAt.toLocaleDateString()}`
                        : (ws.subscription?.status?.toLowerCase() ?? 'none')}
                    </dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-md border border-border bg-muted/30 p-6">
        <h2 className="text-lg font-semibold">Install the CLI</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          envstore is CLI-first. The web dashboard is for managing workspaces, members, and
          billing — but you need the CLI to push and pull encrypted files.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Recommended
            </p>
            <pre className="mt-2 rounded-md border border-border bg-background px-4 py-3 font-mono text-xs">curl -fsSL https://envstore.xyz/install | sh</pre>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Homebrew
            </p>
            <pre className="mt-2 rounded-md border border-border bg-background px-4 py-3 font-mono text-xs">{`brew tap mketzer/envstore
brew install envstore`}</pre>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          The CLI is part of this same repo and will land before the public launch.
        </p>
      </section>

      <section className="text-sm text-muted-foreground">
        <Link href="/" className="underline">
          ← Back to landing
        </Link>
      </section>
    </div>
  );
}
