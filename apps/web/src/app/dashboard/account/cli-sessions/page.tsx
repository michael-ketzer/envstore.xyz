import type { Metadata } from 'next';

import { prisma } from '@envstore/db';
import { DEFAULTS } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { RevokeButton } from './revoke-button';

export const metadata: Metadata = {
  title: 'CLI sessions — envstore',
};

function fmtAgo(date: Date | null): string {
  if (!date) return 'never';
  const diff = Date.now() - date.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function CliSessionsPage() {
  const session = await requireSession();
  const tokens = await prisma.cliToken.findMany({
    where: { userId: session.user.id },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">CLI sessions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every machine that runs <code className="font-mono">envstore login</code> gets a long-lived token.
          Revoke any that you no longer trust — the affected machine won&rsquo;t be able to
          talk to the API anymore (no encrypted data on the server is readable without your local
          identity anyway, this is defense in depth). Cap: {DEFAULTS.maxCliTokensPerUser} active
          tokens.
        </p>
      </div>

      {tokens.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium text-foreground">No CLI sessions yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run <code className="font-mono">envstore login</code> on a machine to create one.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Last used {fmtAgo(t.lastUsedAt)} ·{' '}
                  Created {t.createdAt.toLocaleDateString()}
                  {t.expiresAt ? ` · Expires ${t.expiresAt.toLocaleDateString()}` : ''}
                </div>
              </div>
              <RevokeButton tokenId={t.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
