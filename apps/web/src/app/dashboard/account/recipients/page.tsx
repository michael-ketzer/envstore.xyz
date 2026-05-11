import type { Metadata } from 'next';

import { prisma } from '@envstore/db';
import { LIMITS } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';

export const metadata: Metadata = {
  title: 'Recipients — envstore',
};

export default async function RecipientsPage() {
  const session = await requireSession();
  const recipients = await prisma.userRecipient.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Recipients</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Public keys that other workspace members encrypt to when pushing env files for you.
          Add a recipient by running <code className="font-mono">envstore identity init</code> (or{' '}
          <code className="font-mono">envstore identity register</code> if you already have an
          identity) on each machine. Cap: {LIMITS.maxRecipientsPerUser} per user.
        </p>
      </div>

      {recipients.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium text-foreground">No recipients registered yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Until you register one, teammates cannot encrypt env files to you. Run{' '}
            <code className="font-mono">envstore identity init</code> from your terminal.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {recipients.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="font-medium">{r.label}</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground break-all">
                {r.recipient}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.kind.toLowerCase()} · added {r.createdAt.toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
