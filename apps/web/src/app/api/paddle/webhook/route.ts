// POST /api/paddle/webhook — Paddle webhook receiver.
//
// Signature is verified via the SDK using PADDLE_WEBHOOK_SECRET. Idempotency
// is enforced by inserting a PaddleWebhookEvent row keyed by Paddle's
// `event_id` — the unique-index conflict is our "already processed" signal.
//
// We only act on a small set of event types; everything else is acknowledged
// (so Paddle doesn't retry) and the payload is stored for audit/debug.

import { Prisma, prisma, SubscriptionStatus } from '@envstore/db';
import type {
  EventEntity,
  SubscriptionNotification,
} from '@paddle/paddle-node-sdk';

import { apiError } from '@/lib/api-auth';
import { recordAudit, type AuditAction } from '@/lib/audit';
import { verifyAndParseWebhook, BillingNotConfiguredError } from '@/lib/paddle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Webhook verification uses the Node crypto path of the SDK.

export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get('paddle-signature');
  if (!signature) {
    return apiError('Missing Paddle-Signature header.', 400);
  }

  const rawBody = await req.text();

  let event: EventEntity;
  try {
    event = await verifyAndParseWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return apiError(err.message, 503);
    }
    // Signature mismatch → 400; Paddle treats 4xx as "do not retry" except
    // 408/429, which is what we want for invalid signatures.
    return apiError('Invalid Paddle signature.', 400);
  }

  // Idempotency: race-safe via the unique index on eventId. If the insert
  // fails with P2002 we've already processed this event — return 200 so
  // Paddle stops retrying.
  try {
    await prisma.paddleWebhookEvent.create({
      data: {
        eventId: event.eventId,
        eventType: event.eventType,
        payload: JSON.parse(rawBody) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return Response.json({ ok: true, deduplicated: true });
    }
    throw err;
  }

  try {
    await dispatch(event);
  } catch (err) {
    // We've stored the event; reading it back lets us replay if dispatch is
    // broken. Surface the error so Paddle retries the delivery.
    console.error('Paddle webhook dispatch failed:', err);
    return apiError('Webhook handler failed.', 500);
  }

  return Response.json({ ok: true });
}

async function dispatch(event: EventEntity): Promise<void> {
  switch (event.eventType) {
    case 'subscription.created':
    case 'subscription.activated':
    case 'subscription.trialing':
    case 'subscription.updated':
    case 'subscription.past_due':
    case 'subscription.paused':
    case 'subscription.resumed':
    case 'subscription.canceled':
      await applySubscriptionEvent(
        event.data as SubscriptionNotification,
        event.eventType,
      );
      return;
    default:
      // Ignored: address.*, customer.*, transaction.*, etc. — we don't need
      // them for the workspace state machine.
      return;
  }
}

async function applySubscriptionEvent(
  sub: SubscriptionNotification,
  eventType: string,
): Promise<void> {
  const workspaceId = pickWorkspaceId(sub);
  if (!workspaceId) {
    // Subscription not tied to a workspace — likely a test/manual subscription
    // from the Paddle dashboard. Log and ignore.
    console.warn(
      `Paddle subscription ${sub.id} has no workspaceId in customData; ignoring.`,
    );
    return;
  }

  const data = {
    paddleSubscriptionId: sub.id,
    paddlePriceId: sub.items[0]?.price?.id ?? null,
    status: mapStatus(sub.status),
    trialEndsAt: parseIso(sub.currentBillingPeriod?.endsAt) ?? null,
    currentPeriodEnd: parseIso(sub.currentBillingPeriod?.endsAt) ?? null,
    canceledAt: parseIso(sub.canceledAt),
  } as const;

  // Subscription row was created when the workspace was created (TRIALING).
  // Update it; create only as a defensive fallback for legacy workspaces.
  await prisma.subscription.upsert({
    where: { workspaceId },
    update: data,
    create: { workspaceId, ...data },
  });

  // eventType is one of `subscription.{created|activated|...}`, all of which
  // we've added to the AuditAction union as `billing.subscription.*`. TS can't
  // narrow the template literal, so the cast is safe and local.
  await recordAudit({
    workspaceId,
    action: `billing.${eventType}` as AuditAction,
    resourceType: 'subscription',
    resourceId: sub.id,
    metadata: {
      paddleStatus: sub.status,
      mappedStatus: data.status,
    },
  });
}

// Map Paddle's subscription status strings onto our enum. Paddle exposes more
// granular states than we model (e.g. 'inactive') — we collapse those to the
// closest match.
function mapStatus(paddleStatus: string): SubscriptionStatus {
  switch (paddleStatus) {
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'paused':
      return SubscriptionStatus.PAUSED;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    default:
      // Unknown / inactive → treat as canceled so we don't grant access.
      return SubscriptionStatus.CANCELED;
  }
}

function pickWorkspaceId(sub: SubscriptionNotification): string | null {
  const raw = sub.customData as Record<string, unknown> | null;
  const id = raw?.['workspaceId'];
  return typeof id === 'string' ? id : null;
}

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
