import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@envstore/db';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';

const PAGE_SIZE = 50;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `Audit — ${workspaceSlug} — envstore` };
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);

  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {});
  if (!ws) notFound();

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { email: true, name: true } } },
    }),
    prisma.auditLog.count({ where: { workspaceId: ws.id } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-10">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {ws.name}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">audit</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every workspace-level action — pushes, settings changes, invites, deletions — is recorded
          here. Newest first. Useful for spotting leaks (who pulled what, when) and undoing
          surprise edits.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-10 text-center">
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-4 px-5 py-3 text-sm">
              <time
                dateTime={e.createdAt.toISOString()}
                className="w-44 shrink-0 font-mono text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {formatTimestamp(e.createdAt)}
              </time>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{actorLabel(e.user)}</span>
                  <span className="text-muted-foreground">{actionVerb(e.action)}</span>
                  {describeResource(e) ? (
                    <code className="font-mono text-xs text-foreground">{describeResource(e)}</code>
                  ) : null}
                </div>
                {e.metadata ? (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(e.metadata, null, 0)}
                  </pre>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-xs text-muted-foreground">
          {page > 1 ? (
            <Link
              href={`/dashboard/${workspaceSlug}/audit?page=${page - 1}`}
              className="hover:text-foreground"
            >
              ← Newer
            </Link>
          ) : (
            <span className="opacity-40">← Newer</span>
          )}
          <span>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/dashboard/${workspaceSlug}/audit?page=${page + 1}`}
              className="hover:text-foreground"
            >
              Older →
            </Link>
          ) : (
            <span className="opacity-40">Older →</span>
          )}
        </nav>
      ) : null}

      <section className="text-sm text-muted-foreground">
        <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
          ← Back to {ws.name}
        </Link>
      </section>
    </div>
  );
}

function formatTimestamp(d: Date): string {
  // ISO-ish but readable. Locale-formatted dates would mismatch on SSR vs client.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function actorLabel(user: { email: string; name: string | null } | null): string {
  if (!user) return 'system';
  return user.name?.trim() || user.email;
}

// Human-readable verb for each AuditAction. Falls back to the raw code so a
// newly-introduced action still renders something useful before we update
// this map.
function actionVerb(action: string): string {
  const map: Record<string, string> = {
    'workspace.create': 'created the workspace',
    'workspace.update': 'updated workspace settings',
    'workspace.soft-delete': 'soft-deleted the workspace',
    'workspace.restore': 'restored the workspace',
    'project.create': 'created project',
    'project.update': 'updated project',
    'project.soft-delete': 'soft-deleted project',
    'projectGroup.create': 'created group',
    'projectGroup.update': 'updated group',
    'projectGroup.soft-delete': 'soft-deleted group',
    'environment.create': 'created environment',
    'environment.update': 'updated environment',
    'environment.soft-delete': 'soft-deleted environment',
    'invite.create': 'invited',
    'invite.accept': 'redeemed a setup code for',
    'invite.revoke': 'revoked invite for',
    'member.remove': 'removed member',
    'member.role-change': 'changed member role',
    'recipient.register': 'registered an identity',
    'recipient.revoke': 'revoked an identity',
    'cli-token.create': 'minted a CLI token',
    'cli-token.revoke': 'revoked a CLI token',
    'workspaceToken.create': 'minted a service token',
    'workspaceToken.revoke': 'revoked a service token',
    'billing.subscription.created': 'started billing',
    'billing.subscription.activated': 'activated subscription',
    'billing.subscription.trialing': 'started trial',
    'billing.subscription.updated': 'updated subscription',
    'billing.subscription.past_due': 'subscription went past due',
    'billing.subscription.paused': 'paused subscription',
    'billing.subscription.resumed': 'resumed subscription',
    'billing.subscription.canceled': 'canceled subscription',
    'billing.cancel_requested': 'requested cancellation',
  };
  return map[action] ?? action;
}

function describeResource(e: {
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown;
}): string | null {
  // Most recordAudit calls put the slug into metadata.slug — prefer that
  // because the row id (cuid) is opaque to the user.
  const meta = (e.metadata as Record<string, unknown> | null) ?? null;
  const slug = typeof meta?.['slug'] === 'string' ? (meta['slug'] as string) : null;
  if (slug && e.resourceType) return `${e.resourceType} · ${slug}`;
  if (e.resourceType && e.resourceId) return `${e.resourceType} · ${e.resourceId}`;
  return e.resourceType ?? null;
}
