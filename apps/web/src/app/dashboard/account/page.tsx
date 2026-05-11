import type { Metadata } from 'next';

import { prisma } from '@envstore/db';

import { requireSession } from '@/lib/auth-helpers';

export const metadata: Metadata = {
  title: 'Profile — envstore',
};

export default async function AccountPage() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { accounts: { select: { provider: true } } },
  });
  if (!user) return null;
  const providers = user.accounts.map((a) => a.provider);
  return (
    <section className="space-y-8">
      <div className="rounded-md border border-border p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Identity
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-mono">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user.name ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Sign-in methods</dt>
            <dd className="font-mono">
              {providers.length > 0 ? providers.join(', ') : 'email OTP'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{user.createdAt.toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
