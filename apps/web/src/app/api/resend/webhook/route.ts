// POST /api/resend/webhook — Resend webhook receiver.
//
// Resend delivers webhooks via Svix with the standard svix-id / svix-timestamp
// / svix-signature headers. We verify with RESEND_WEBHOOK_SECRET, then forward
// `email.received` events to the address in RESEND_INBOUND_FORWARD_TO so the
// envstore inbox (legal@, privacy@, billing@, …) lands in a real mailbox.
//
// All other event types (email.sent, email.delivered, etc.) are acknowledged
// with 200 OK so Resend doesn't retry them — we just don't act on them yet.

import { Webhook } from 'svix';

import { apiError } from '@/lib/api-auth';
import {
  forwardInboundEmail,
  EmailForwardNotConfiguredError,
  type InboundEmail,
} from '@/lib/email-forward';
import { env, features } from '@/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ResendWebhookEnvelope = {
  type?: string;
  data?: InboundEmail;
};

export async function POST(req: Request): Promise<Response> {
  if (!features.emailInboundForward || !env.RESEND_WEBHOOK_SECRET) {
    return apiError('Inbound email forwarding is not configured.', 503);
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return apiError('Missing Svix signature headers.', 400);
  }

  const rawBody = await req.text();

  let event: ResendWebhookEnvelope;
  try {
    const wh = new Webhook(env.RESEND_WEBHOOK_SECRET);
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendWebhookEnvelope;
  } catch {
    return apiError('Invalid Resend webhook signature.', 400);
  }

  if (event.type !== 'email.received') {
    // Acknowledge other event types so Resend stops retrying — we just don't
    // act on them yet.
    return Response.json({ ok: true, ignored: event.type ?? 'unknown' });
  }

  if (!event.data) {
    return apiError('Webhook payload missing data.', 400);
  }

  try {
    await forwardInboundEmail(event.data);
  } catch (err) {
    if (err instanceof EmailForwardNotConfiguredError) {
      return apiError(err.message, 503);
    }
    // Log only the message — the raw exception can include the inbound
    // email body, subject, or attachment metadata via Resend SDK errors,
    // and we don't want forwarded mail content tee'd into runtime logs.
    const message = err instanceof Error ? err.message : String(err);
    console.error('Resend inbound forwarding failed:', message);
    // Return 500 so Resend retries.
    return apiError('Forwarding failed.', 500);
  }

  return Response.json({ ok: true });
}
