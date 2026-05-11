// Paddle server utility — wraps the official SDK with a thin layer that
// hides the env switch and handles the "no API key configured" case so that
// dev environments (and CI builds without secrets) don't crash on import.
//
// All Paddle interaction goes through this module:
// - getPaddleClient(): singleton SDK instance (or null when not configured)
// - ensurePaddleCustomer(): creates the User's Paddle Customer if missing
// - createWorkspaceCheckout(): mints a Transaction the frontend overlay opens
// - cancelWorkspaceSubscription(): cancel at next billing period
// - createCustomerPortalSession(): self-serve payment-method updates
// - verifyAndParseWebhook(): signature check + typed event return
import 'server-only';

import {
  ApiError,
  Environment,
  Paddle,
  type EventEntity,
} from '@paddle/paddle-node-sdk';

import { prisma } from '@envstore/db';

import { env } from '@/env';

let cached: Paddle | null | undefined;

// Returns the SDK client, or null if Paddle isn't configured. Callers MUST
// handle the null case (typically by returning 503 from an API route).
export function getPaddleClient(): Paddle | null {
  if (cached !== undefined) return cached;
  if (!env.PADDLE_API_KEY) {
    cached = null;
    return null;
  }
  cached = new Paddle(env.PADDLE_API_KEY, {
    environment:
      env.PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox,
  });
  return cached;
}

// Idempotent: returns the User's existing paddleCustomerId, or creates a new
// Paddle Customer and persists the ID. We index Paddle customers by envstore
// User (not Workspace) so the same payment method covers all workspaces the
// user subscribes to.
//
// If a Paddle customer already exists for this email (e.g. left over from a
// previous attempt where we didn't persist the ID, or carried over from an
// earlier account), we adopt it instead of failing. Otherwise the user would
// be permanently locked out of checkout.
export async function ensurePaddleCustomer(user: {
  id: string;
  email: string;
  name: string | null;
  paddleCustomerId: string | null;
}): Promise<string> {
  if (user.paddleCustomerId) return user.paddleCustomerId;

  const paddle = getPaddleClient();
  if (!paddle) throw new BillingNotConfiguredError();

  let customerId: string;
  try {
    const customer = await paddle.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      customData: { envstoreUserId: user.id },
    });
    customerId = customer.id;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'customer_already_exists') {
      customerId = await findPaddleCustomerIdByEmail(paddle, user.email);
    } else {
      throw err;
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { paddleCustomerId: customerId },
  });

  return customerId;
}

// Looks up a Paddle Customer by email. Used to recover from the
// `customer_already_exists` conflict in `ensurePaddleCustomer`.
async function findPaddleCustomerIdByEmail(
  paddle: Paddle,
  email: string,
): Promise<string> {
  const collection = paddle.customers.list({ email: [email] });
  for await (const customer of collection) {
    if (customer.email.toLowerCase() === email.toLowerCase()) {
      return customer.id;
    }
  }
  // Paddle just told us there's a conflict — if list returns nothing the
  // customer was archived. Surface a clear error instead of silently retrying.
  throw new Error(
    `Paddle reported a customer conflict for ${email} but no matching customer was found via list. The existing customer may be archived.`,
  );
}

// Creates a Paddle Transaction for the team workspace plan. Returns the
// transaction ID — the frontend opens the Paddle.js inline checkout with this
// ID and Paddle handles card capture + subscription creation. We tag the
// transaction with customData.workspaceId so the webhook can route the
// resulting subscription onto the right workspace.
export async function createWorkspaceCheckout(args: {
  workspaceId: string;
  customerId: string;
}): Promise<{ transactionId: string }> {
  const paddle = getPaddleClient();
  if (!paddle) throw new BillingNotConfiguredError();
  if (!env.PADDLE_PRICE_ID_TEAM) throw new BillingNotConfiguredError();

  const tx = await paddle.transactions.create({
    items: [{ priceId: env.PADDLE_PRICE_ID_TEAM, quantity: 1 }],
    customerId: args.customerId,
    customData: { workspaceId: args.workspaceId },
  });

  return { transactionId: tx.id };
}

// Cancels at the END of the current billing period (so the user keeps access
// they already paid for). Paddle will fire `subscription.canceled` once the
// period elapses; our webhook flips workspace state then.
export async function cancelSubscriptionAtPeriodEnd(
  paddleSubscriptionId: string,
): Promise<void> {
  const paddle = getPaddleClient();
  if (!paddle) throw new BillingNotConfiguredError();
  // `effectiveFrom: 'next_billing_period'` is the documented value for "cancel
  // at end of period". The SDK exposes it via the SubscriptionEffectiveFrom
  // enum but accepts the underlying string literal too.
  await paddle.subscriptions.cancel(paddleSubscriptionId, {
    effectiveFrom: 'next_billing_period',
  });
}

// Generates a one-time signed URL for the Paddle-hosted customer portal so
// the user can update card details on file. `subscriptionIds` scopes which
// subscriptions the portal lists.
export async function createCustomerPortalSession(
  customerId: string,
  subscriptionIds: string[],
): Promise<{ overviewUrl: string }> {
  const paddle = getPaddleClient();
  if (!paddle) throw new BillingNotConfiguredError();
  const session = await paddle.customerPortalSessions.create(
    customerId,
    subscriptionIds,
  );
  return { overviewUrl: session.urls.general.overview };
}

// Verifies the Paddle-Signature header and returns the parsed event entity.
// Throws if the signature is invalid (we treat this as 400 from the webhook
// route — Paddle's retry policy handles the rest).
export async function verifyAndParseWebhook(
  rawBody: string,
  signatureHeader: string,
): Promise<EventEntity> {
  const paddle = getPaddleClient();
  if (!paddle) throw new BillingNotConfiguredError();
  if (!env.PADDLE_WEBHOOK_SECRET) throw new BillingNotConfiguredError();
  return paddle.webhooks.unmarshal(
    rawBody,
    env.PADDLE_WEBHOOK_SECRET,
    signatureHeader,
  );
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Paddle billing is not configured on this environment.');
    this.name = 'BillingNotConfiguredError';
  }
}
