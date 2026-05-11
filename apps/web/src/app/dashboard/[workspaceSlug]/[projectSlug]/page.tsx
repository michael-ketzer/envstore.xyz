import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@envstore/db';
import { buttonVariants } from '@envstore/ui';
import {
  ENVSTORE_CONFIG_FILENAME,
  defaultFilenameForEnvironment,
  renderEnvstoreConfig,
} from '@envstore/shared';

import { CodeBlock } from '@/components/code-block';
import { clientEnv } from '@/env.client';
import { requireSession } from '@/lib/auth-helpers';
import { getProjectForUser } from '@/lib/projects';
import { ensureLinkCode, formatLinkCode } from '@/lib/project-link-codes';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug, projectSlug } = await params;
  return { title: `${workspaceSlug}/${projectSlug} — envstore` };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug, projectSlug } = await params;
  const [project, recipientCount] = await Promise.all([
    getProjectForUser(workspaceSlug, projectSlug, session.user.id, {
      workspace: { select: { slug: true, name: true } },
      environments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          currentVersion: { select: { version: true, createdAt: true, ciphertextSize: true } },
          _count: { select: { versions: true } },
        },
      },
    }),
    prisma.userRecipient.count({ where: { userId: session.user.id } }),
  ]);
  if (!project) notFound();

  // If the user already has a registered recipient, they've done install + sign-in
  // + identity init on at least one machine. Collapse those steps by default;
  // they can still expand for reference.
  const hasIdentity = recipientCount > 0;

  // Project's durable setup code — generated at project creation, lazy-filled
  // for legacy rows. Shown verbatim on the page; anyone with workspace
  // membership can redeem it via `envstore link <CODE>`.
  const linkCode = formatLinkCode(await ensureLinkCode(project.id));
  const linkCommand = `envstore link ${linkCode}`;

  const defaultEnvSlug = project.environments[0]?.slug;
  const envstoreJson = renderEnvstoreConfig({
    workspace: project.workspace.slug,
    project: project.slug,
    defaultEnv: defaultEnvSlug,
    schemaUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/schema/${ENVSTORE_CONFIG_FILENAME}`,
  });

  return (
    <div className="space-y-12">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground">
            workspaces
          </Link>
          <span className="px-1">/</span>
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {workspaceSlug}
          </Link>
          <span className="px-1">/</span>
          <span className="font-mono text-foreground">{project.slug}</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
            {project.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{project.description}</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Link
              href={`/dashboard/${workspaceSlug}/${project.slug}/settings`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Settings
            </Link>
            <Link
              href={`/dashboard/${workspaceSlug}/${project.slug}/environments/new`}
              className={buttonVariants({ size: 'sm' })}
            >
              New environment
            </Link>
          </div>
        </div>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Environments</h2>
        {project.environments.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-8">
            <p className="text-sm font-medium text-foreground">No environments yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The CLI creates environments automatically based on filename — push{' '}
              <code className="font-mono">.env.production</code> and a{' '}
              <code className="font-mono">production</code> environment appears here. Or create
              one ahead of time below.
            </p>
            <Link
              href={`/dashboard/${workspaceSlug}/${project.slug}/environments/new`}
              className={`${buttonVariants({ size: 'sm' })} mt-6`}
            >
              Create environment
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {project.environments.map((env) => (
              <li key={env.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-baseline gap-3">
                    <span className="font-medium">{env.name}</span>
                    <code className="font-mono text-xs text-muted-foreground">{env.slug}</code>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    push{' '}
                    <code className="font-mono">{defaultFilenameForEnvironment(env.slug)}</code> →
                    autodetected as <code className="font-mono">{env.slug}</code>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {env.currentVersion ? (
                    <>
                      <div>v{env.currentVersion.version}</div>
                      <div>{env._count.versions} total</div>
                    </>
                  ) : (
                    <span className="italic">never pushed</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Connect this project</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Generate a one-off setup code, then run{' '}
          <code className="font-mono text-foreground">envstore link &lt;CODE&gt;</code> in your
          repo to drop a committable <code className="font-mono">envstore.json</code> file. No
          secrets in it — just the workspace and project slugs.
        </p>

        <div className="mt-6 space-y-4">
          {hasIdentity ? (
            <details className="rounded-md border border-border bg-muted/30">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium hover:text-foreground">
                <span className="text-muted-foreground">
                  CLI install + sign-in (you've done this — expand if you need it on another
                  machine)
                </span>
              </summary>
              <div className="space-y-3 px-4 pb-4">
                <CliInstallStep />
                <CliSignInStep />
              </div>
            </details>
          ) : (
            <ol className="space-y-3">
              <Step n={1} title="Install the CLI">
                <pre className="mt-2 inline-block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
                  curl -fsSL {clientEnv.NEXT_PUBLIC_APP_URL}/install | sh
                </pre>
              </Step>
              <Step n={2} title="Sign in & set up your identity">
                <pre className="mt-2 inline-block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
{`envstore login
envstore identity init`}
                </pre>
                <p className="mt-2 text-xs text-muted-foreground">
                  Generates your local age key and registers your public recipient with the
                  server. Without this, push/pull cannot encrypt to you.
                </p>
              </Step>
            </ol>
          )}

          <ol className="space-y-3" start={hasIdentity ? 1 : 3}>
            <Step
              n={hasIdentity ? 1 : 3}
              title="Link this project from your repo"
            >
              <div className="mt-3 space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  setup command
                </p>
                <CodeBlock code={linkCommand} label="Copy setup command" />
                <p className="text-xs text-muted-foreground">
                  Anyone with workspace access can run this to get{' '}
                  <code className="font-mono">envstore.json</code>. The code is gated by
                  workspace membership at redemption — non-members can't use it.
                </p>
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Or write <code className="font-mono">envstore.json</code> by hand
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {ENVSTORE_CONFIG_FILENAME}
                  </p>
                  <CodeBlock code={envstoreJson} label="Copy envstore.json" />
                  <p className="text-muted-foreground">
                    Save this at the repo root and commit it.
                  </p>
                </div>
              </details>
            </Step>
            <Step
              n={hasIdentity ? 2 : 4}
              title="Push your first .env"
            >
              <pre className="mt-2 inline-block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
                envstore push .env
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                Encrypts locally before upload — only your registered identities can decrypt.
              </p>
            </Step>
          </ol>
        </div>
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

function CliInstallStep() {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Install
      </p>
      <pre className="mt-1 inline-block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
        curl -fsSL {clientEnv.NEXT_PUBLIC_APP_URL}/install | sh
      </pre>
    </div>
  );
}

function CliSignInStep() {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Sign in + identity
      </p>
      <pre className="mt-1 inline-block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
{`envstore login
envstore identity init`}
      </pre>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-md border border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-mono text-xs text-primary-foreground">
          {n}
        </span>
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-1 pl-9">{children}</div>
    </li>
  );
}
