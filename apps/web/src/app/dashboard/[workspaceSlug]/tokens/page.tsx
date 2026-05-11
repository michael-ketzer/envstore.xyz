import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { WorkspaceRole } from '@envstore/shared';

import { CodeBlock } from '@/components/code-block';
import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';
import { hasAtLeastRole } from '@/lib/workspace-roles';
import { listWorkspaceTokens } from '@/lib/workspace-tokens';

import { RevokeTokenButton } from './revoke-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `Tokens — ${workspaceSlug} — envstore` };
}

export default async function TokensPage({
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

  const myRole = ws.members[0]?.role as WorkspaceRole | undefined;
  const isAdmin = myRole !== undefined && hasAtLeastRole(myRole, 'ADMIN');
  if (!isAdmin) notFound();

  const tokens = await listWorkspaceTokens(ws.id);

  return (
    <div className="space-y-10">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {ws.name}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">tokens</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Service tokens</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Workspace-scoped credentials for CI/CD and other non-human pulls. A service token
          carries both a bearer (authenticates the API call) and an age private key (decrypts
          ciphertext). Both are generated on YOUR machine when you mint the token — the server
          never sees the private key.
        </p>
      </header>

      <section className="rounded-md border border-border bg-muted/30 p-5">
        <h2 className="text-sm font-semibold">Create a new token</h2>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
          Run this on a machine where the CLI is signed in as a workspace admin. The bearer +
          identity are printed once; paste them into your CI provider's secret store as{' '}
          <code className="font-mono">ENVSTORE_TOKEN</code> and{' '}
          <code className="font-mono">ENVSTORE_IDENTITY</code>. We don't offer in-browser
          creation deliberately — keeping age private keys out of the browser is part of the
          zero-knowledge guarantee.
        </p>
        <div className="mt-4">
          <CodeBlock
            code={`envstore token create ci-prod --workspace ${workspaceSlug}`}
            label="Copy create command"
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Existing tokens</h2>
        {tokens.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-10 text-center">
            <p className="text-sm text-muted-foreground">No service tokens yet.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className={tokenStatusClass(t)}>{tokenStatusLabel(t)}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                    <span>
                      Created{' '}
                      <time dateTime={t.createdAt} suppressHydrationWarning>
                        {t.createdAt.slice(0, 10)}
                      </time>
                      {t.createdByEmail ? ` by ${t.createdByEmail}` : ''}
                    </span>
                    <span>
                      Last used:{' '}
                      {t.lastUsedAt ? (
                        <time dateTime={t.lastUsedAt} suppressHydrationWarning>
                          {t.lastUsedAt.slice(0, 10)}
                        </time>
                      ) : (
                        <span className="italic">never</span>
                      )}
                    </span>
                    <span>
                      Expires:{' '}
                      {t.expiresAt ? (
                        <time dateTime={t.expiresAt} suppressHydrationWarning>
                          {t.expiresAt.slice(0, 10)}
                        </time>
                      ) : (
                        <span className="italic">never</span>
                      )}
                    </span>
                    <span>Scopes: {t.scopes.join(', ')}</span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                    recipient: {truncateMiddle(t.recipient, 20, 12)}
                  </div>
                </div>
                {!t.revokedAt ? (
                  <div className="shrink-0">
                    <RevokeTokenButton workspaceSlug={workspaceSlug} tokenId={t.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-sm text-muted-foreground">
        <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
          ← Back to {ws.name}
        </Link>
      </section>
    </div>
  );
}

function tokenStatusLabel(t: { revokedAt: string | null; expiresAt: string | null }): string {
  if (t.revokedAt) return 'revoked';
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) return 'expired';
  return 'active';
}

function tokenStatusClass(t: { revokedAt: string | null; expiresAt: string | null }): string {
  const base = 'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest';
  if (t.revokedAt) return `${base} bg-muted text-muted-foreground`;
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) {
    return `${base} bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200`;
  }
  return `${base} bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200`;
}

function truncateMiddle(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
