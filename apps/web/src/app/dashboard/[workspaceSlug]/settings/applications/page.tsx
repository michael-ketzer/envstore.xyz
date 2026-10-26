import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { env, features } from '@/env';
import { CodeBlock } from '@/components/code-block';
import { requireSession } from '@/lib/auth-helpers';
import { listApplications } from '@/lib/managed-keys/applications';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

import { ApplicationForm } from './application-form';
import { RevokeApplicationButton } from './revoke-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `Encryption applications — ${workspaceSlug} — envstore` };
}

export default async function ApplicationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, session.user.id, 'ADMIN');
  if (!membership) notFound();
  const ws = membership.workspace;
  const applications = features.managedKeys ? await listApplications(ws.id) : [];
  const apiUrl = new URL(env.NEXT_PUBLIC_APP_URL ?? 'https://www.envstore.xyz').origin;
  const audience = new URL(env.MANAGED_KEYS_AUDIENCE ?? apiUrl).origin;
  const runtimePath = `/api/v1/workspaces/${ws.slug}/data-keys`;

  return (
    <div className="space-y-10">
      <header>
        <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {ws.name}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">encryption</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Encryption applications</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Connect a backend to envstore’s managed encryption service. Register its key purpose and
          environment, then use an application token or Vercel OIDC to generate and unwrap data
          keys.
        </p>
      </header>

      {features.managedKeys ? (
        <section className="border-border bg-muted/20 rounded-lg border p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Register an application</h2>
          <div className="mt-5">
            <ApplicationForm
              workspaceSlug={workspaceSlug}
              apiWorkspaceSlug={ws.slug}
              apiUrl={apiUrl}
              audience={audience}
            />
          </div>
        </section>
      ) : (
        <div role="status" className="border-border bg-muted/30 rounded-lg border p-5">
          <h2 className="text-sm font-semibold">Application encryption is not configured</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The installation administrator needs to enable the managed encryption service before you
            can register applications.
          </p>
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold">Registered applications</h2>
        {applications.length === 0 ? (
          <div className="border-border bg-muted/20 mt-4 rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No encryption applications registered yet.
            </p>
          </div>
        ) : (
          <ul className="divide-border border-border mt-4 divide-y rounded-lg border">
            {applications.map((application) => {
              const expired = application.expiresAt !== null && application.expiresAt <= new Date();
              const status = application.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active';
              return (
                <li
                  key={application.id}
                  className="flex flex-wrap items-start justify-between gap-4 p-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-all">{application.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${status === 'Active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
                      >
                        {status}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-2 font-mono text-xs break-all">
                      {application.environment} / {application.keyName} / {application.purpose}
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {application.vercelProjectId ? 'Vercel OIDC' : 'Application token'} · Up to{' '}
                      {application.maxTenants.toLocaleString('en-US')} tenants
                      {application.expiresAt
                        ? ` · Expires ${application.expiresAt.toISOString().slice(0, 10)}`
                        : ''}
                    </p>
                    {application.vercelProjectId ? (
                      <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                        {application.vercelTeamId} / {application.vercelProjectId} /{' '}
                        {application.vercelEnvironment}
                      </p>
                    ) : null}
                  </div>
                  {!application.revokedAt ? (
                    <RevokeApplicationButton
                      workspaceSlug={workspaceSlug}
                      applicationId={application.id}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {features.managedKeys ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Backend endpoints</h2>
          <CodeBlock
            code={`POST ${apiUrl}${runtimePath}\nPOST ${apiUrl}${runtimePath}/unwrap`}
            copyable={false}
            className="w-full"
          />
          <p className="text-muted-foreground text-sm">
            Send the application token as a bearer. Vetdocs sends{' '}
            <code className="font-mono">purpose=vetdocs-umk-v1</code>,{' '}
            <code className="font-mono">tenantId=userId</code>, and{' '}
            <code className="font-mono">subjectId=umk:1</code>.
          </p>
        </section>
      ) : null}
    </div>
  );
}
