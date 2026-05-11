import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PRICING } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceAccess } from '@/lib/billing';
import { env, features } from '@/env';
import { clientEnv } from '@/env.client';
import { getWorkspaceForUser } from '@/lib/workspaces';

import { BillingActions } from './billing-actions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}): Promise<Metadata> {
  const { workspaceSlug } = await params;
  return { title: `Billing — ${workspaceSlug} — envstore` };
}

const priceDollars = (PRICING.monthlyCents / 100).toFixed(2);

export default async function BillingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {
    subscription: true,
    members: { where: { userId: session.user.id }, select: { role: true } },
  });
  if (!ws) notFound();

  const isPersonal = ws.type === 'PERSONAL';
  const isOwner = ws.ownerId === session.user.id;
  const access = getWorkspaceAccess(ws);
  const sub = ws.subscription;
  const billingConfigured =
    features.paddle && Boolean(clientEnv.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN);

  return (
    <div className="space-y-10">
      <header>
        <nav className="text-xs text-muted-foreground">
          <Link href={`/dashboard/${workspaceSlug}`} className="hover:text-foreground">
            {workspaceSlug}
          </Link>
          <span className="px-1">/</span>
          <span className="text-foreground">billing</span>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace: <span className="font-medium text-foreground">{ws.name}</span>
        </p>
      </header>

      <AccessBanner
        tier={access.tier}
        reason={access.reason}
        message={access.message}
      />

      <section className="space-y-4 rounded-md border border-border p-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-semibold">
            {isPersonal ? 'Personal workspace' : 'Team plan'}
          </h2>
          <span className="font-mono text-sm text-muted-foreground">
            ${priceDollars} / month
            {isPersonal ? null : ' · unlimited members'}
          </span>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailRow label="Status" value={subscriptionStatusLabel(sub?.status, access.reason)} />
          {sub?.trialEndsAt && access.reason === 'trialing' ? (
            <DetailRow label="Trial ends" value={sub.trialEndsAt.toLocaleString()} />
          ) : null}
          {sub?.currentPeriodEnd && access.reason === 'active' ? (
            <DetailRow label="Renews" value={sub.currentPeriodEnd.toLocaleString()} />
          ) : null}
          {sub?.canceledAt ? (
            <DetailRow label="Canceled at" value={sub.canceledAt.toLocaleString()} />
          ) : null}
        </dl>

        {!isOwner ? (
          <p className="text-sm text-muted-foreground">
            Only the workspace owner can manage billing.
          </p>
        ) : !billingConfigured ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            Billing is not configured on this deployment. Set{' '}
            <code className="font-mono">PADDLE_API_KEY</code>,{' '}
            <code className="font-mono">PADDLE_WEBHOOK_SECRET</code>,{' '}
            <code className="font-mono">PADDLE_PRICE_ID_TEAM</code>, and{' '}
            <code className="font-mono">NEXT_PUBLIC_PADDLE_CLIENT_TOKEN</code>.
          </p>
        ) : (
          <BillingActions
            workspaceSlug={workspaceSlug}
            paddleEnv={env.PADDLE_ENV}
            paddleClientToken={clientEnv.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!}
            hasPaddleSubscription={Boolean(sub?.paddleSubscriptionId)}
            accessReason={access.reason}
          />
        )}
      </section>

      <section className="space-y-3 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">Payment processor</h2>
        <p>
          Payments are processed by{' '}
          <a
            href="https://www.paddle.com"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            Paddle
          </a>{' '}
          as our merchant of record (applicable VAT/sales tax handled
          automatically). See our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/refund" className="underline hover:text-foreground">
            Refund Policy
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function AccessBanner({
  tier,
  reason,
  message,
}: {
  tier: 'full' | 'read-only' | 'locked';
  reason: string;
  message: string;
}) {
  if (tier === 'full' && (reason === 'active' || reason === 'trialing')) {
    return null;
  }
  const color =
    tier === 'locked'
      ? 'border-destructive/40 bg-destructive/10'
      : tier === 'read-only'
        ? 'border-amber-500/40 bg-amber-500/10'
        : 'border-amber-500/40 bg-amber-500/10';
  return (
    <div className={`rounded-md border ${color} p-4 text-sm`}>
      <strong className="font-semibold">Heads up.</strong> {message}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function subscriptionStatusLabel(
  status: string | undefined | null,
  reason: string,
): string {
  if (reason === 'trial-expired') return 'Trial expired';
  if (reason === 'cancel-grace') return 'Canceled (read-only grace)';
  if (reason === 'cancel-expired') return 'Canceled';
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'TRIALING':
      return 'Trialing';
    case 'PAST_DUE':
      return 'Payment failed — retrying';
    case 'PAUSED':
      return 'Paused';
    case 'CANCELED':
      return 'Canceled';
    default:
      return 'Unknown';
  }
}
