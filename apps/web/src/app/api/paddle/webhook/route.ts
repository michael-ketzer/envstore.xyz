// POST /api/paddle/webhook — Paddle webhook receiver.
//
// Signature is verified via the SDK using PADDLE_WEBHOOK_SECRET. Idempotency
// is enforced with two layers:
//
//   1. Unique index on PaddleWebhookEvent.eventId — keeps duplicate inserts
//      out of the audit table.
//   2. Postgres transaction-scoped advisory lock keyed on the eventId —
//      serializes concurrent deliveries of the same event so two parallel
//      retries (e.g. Paddle's retry arriving while the first delivery is
//      still dispatching) can't both run dispatch. The lock auto-releases
//      at COMMIT/ROLLBACK, so a crashed handler doesn't strand the slot —
//      the next delivery acquires the lock cleanly and either re-runs
//      dispatch (processedAt still null) or returns dedup (processedAt
//      set by a previous successful run).
//
// receivedAt is set on insert. processedAt is set ONLY after dispatch
// succeeds — a row with null processedAt means the previous delivery's
// handler crashed before finishing and the next retry must re-run dispatch.

import { type Prisma, prisma, SubscriptionStatus } from '@envstore/db';
import type {
  EventEntity,
  SubscriptionNotification,
} from '@paddle/paddle-node-sdk';

import { apiError } from '@/lib/api-auth';
import { type AuditAction } from '@/lib/audit';
import { verifyAndParseWebhook, BillingNotConfiguredError } from '@/lib/paddle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Webhook verification uses the Node crypto path of the SDK.

// Prisma's interactive-transaction callback receives a TransactionClient.
// The runtime tx exposes every model accessor on the regular prisma client
// PLUS the raw-SQL helpers we need for the advisory lock.
type Tx = Prisma.TransactionClient;

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

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        // Acquire an exclusive transaction-scoped advisory lock keyed on
        // the event id. Any other connection trying to acquire the same
        // lock blocks here until our transaction ends (commit or
        // rollback), at which point Postgres auto-releases. This gives us
        // strict serialization across parallel duplicate deliveries
        // without a TTL or claim-row to clean up. hashtext narrows the
        // eventId (a string) to the 32-bit lock-id space — collisions
        // across unrelated events are harmless (they'd just queue).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${event.eventId}))`;

        const existing = await tx.paddleWebhookEvent.findUnique({
          where: { eventId: event.eventId },
          select: { processedAt: true },
        });
        if (existing?.processedAt) {
          return 'deduplicated' as const;
        }

        if (!existing) {
          await tx.paddleWebhookEvent.create({
            data: {
              eventId: event.eventId,
              eventType: event.eventType,
              payload: JSON.parse(rawBody) as Prisma.InputJsonValue,
              // processedAt left null — set after successful dispatch below.
            },
          });
        }

        // Dispatch happens INSIDE the lock + transaction. If dispatch
        // throws, the whole tx rolls back (the receivedAt row disappears
        // too) and the next retry starts clean.
        await dispatch(event, tx);

        await tx.paddleWebhookEvent.update({
          where: { eventId: event.eventId },
          data: { processedAt: new Date() },
        });
        return 'processed' as const;
      },
      // 15s is comfortably more than dispatch needs (an upsert + audit
      // insert) and short enough that a stuck delivery doesn't tie up a
      // connection pool slot indefinitely.
      { timeout: 15_000 },
    );

    if (outcome === 'deduplicated') {
      return Response.json({ ok: true, deduplicated: true });
    }
    return Response.json({ ok: true });
  } catch (err) {
    // Transaction rolled back. processedAt was never stamped (and the
    // receivedAt row was rolled back too if it was a fresh insert), so the
    // next Paddle retry re-runs dispatch from a clean slate.
    console.error('Paddle webhook dispatch failed:', err);
    return apiError('Webhook handler failed.', 500);
  }
}

async function dispatch(event: EventEntity, tx: Tx): Promise<void> {
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
        tx,
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
  tx: Tx,
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
  await tx.subscription.upsert({
    where: { workspaceId },
    update: data,
    create: { workspaceId, ...data },
  });

  // Audit log entry — written via the transaction so a dispatch failure
  // doesn't leave a half-recorded billing event in the log. The shared
  // recordAudit helper writes via the global prisma client, which would
  // commit outside this transaction; we inline the create here instead.
  // eventType is one of `subscription.{created|activated|...}`, all of which
  // we've added to the AuditAction union as `billing.subscription.*`. TS can't
  // narrow the template literal, so the cast is safe and local.
  const action = `billing.${eventType}` as AuditAction;
  await tx.auditLog.create({
    data: {
      workspaceId,
      userId: null,
      workspaceTokenId: null,
      action,
      resourceType: 'subscription',
      resourceId: sub.id,
      metadata: {
        paddleStatus: sub.status,
        mappedStatus: data.status,
      },
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
