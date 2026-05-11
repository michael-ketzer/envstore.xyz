'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { initializePaddle, type Paddle } from '@paddle/paddle-js';

import { Button } from '@envstore/ui';

type Props = {
  workspaceSlug: string;
  paddleEnv: 'sandbox' | 'production';
  paddleClientToken: string;
  // True once a checkout has succeeded and we've stored a paddle_subscription_id.
  hasPaddleSubscription: boolean;
  // Drives which set of action buttons to surface.
  accessReason:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'trial-expired'
    | 'paused'
    | 'cancel-grace'
    | 'cancel-expired'
    | 'unconfigured';
};

export function BillingActions({
  workspaceSlug,
  paddleEnv,
  paddleClientToken,
  hasPaddleSubscription,
  accessReason,
}: Props) {
  const router = useRouter();
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [busy, setBusy] = useState<null | 'subscribe' | 'cancel' | 'portal'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initializePaddle({
      environment: paddleEnv,
      token: paddleClientToken,
      eventCallback: (data) => {
        if (data?.name === 'checkout.completed') {
          // Webhook will populate paddleSubscriptionId; refresh after a beat
          // so the server-rendered status reflects the new state.
          setTimeout(() => router.refresh(), 1500);
        }
      },
    })
      .then((instance) => {
        if (!cancelled && instance) setPaddle(instance);
      })
      .catch((err) => {
        console.error('Paddle.js init failed:', err);
        if (!cancelled) setError('Failed to load checkout. Refresh and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [paddleEnv, paddleClientToken, router]);

  async function onSubscribe() {
    if (!paddle) return;
    setError(null);
    setBusy('subscribe');
    try {
      const res = await fetch(
        `/api/v1/workspaces/${workspaceSlug}/billing/checkout`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to start checkout.');
      }
      const { transactionId } = (await res.json()) as { transactionId: string };
      paddle.Checkout.open({ transactionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onManage() {
    setError(null);
    setBusy('portal');
    try {
      const res = await fetch(
        `/api/v1/workspaces/${workspaceSlug}/billing/portal`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to open billing portal.');
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onCancel() {
    if (!confirm('Cancel at the end of the current billing period?')) return;
    setError(null);
    setBusy('cancel');
    try {
      const res = await fetch(
        `/api/v1/workspaces/${workspaceSlug}/billing/cancel`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to cancel.');
      }
      // Cancel takes effect at period end; webhook updates state. Refresh to
      // pick up the canceledAt that Paddle reports back.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Decide which buttons to render based on current state. The state machine
  // is small enough that explicit branches read cleaner than a Map.
  const showSubscribe =
    !hasPaddleSubscription ||
    accessReason === 'trial-expired' ||
    accessReason === 'cancel-grace' ||
    accessReason === 'cancel-expired';
  const showManage = hasPaddleSubscription && accessReason !== 'cancel-expired';
  const showCancel =
    hasPaddleSubscription &&
    (accessReason === 'active' || accessReason === 'past_due' || accessReason === 'trialing');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {showSubscribe ? (
          <Button onClick={onSubscribe} disabled={!paddle || busy !== null}>
            {busy === 'subscribe' ? 'Opening checkout…' : 'Subscribe — $1.99 / mo'}
          </Button>
        ) : null}
        {showManage ? (
          <Button
            variant="outline"
            onClick={onManage}
            disabled={busy !== null}
          >
            {busy === 'portal' ? 'Opening…' : 'Manage payment method'}
          </Button>
        ) : null}
        {showCancel ? (
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={busy !== null}
            className="text-destructive hover:text-destructive"
          >
            {busy === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {paddleEnv === 'sandbox' ? (
        <p className="text-xs text-muted-foreground">
          Paddle <strong>sandbox</strong> mode — no real charges. Use a Paddle
          sandbox test card.
        </p>
      ) : null}
    </div>
  );
}
