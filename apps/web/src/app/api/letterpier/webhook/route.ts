// Letterpier signs the unchanged JSON body with Svix-compatible HMAC headers.
// Received events contain an ID, not the body or attachment contents.
import { Webhook } from 'svix';

import { apiError } from '@/lib/api-auth';
import { getInboundEmail } from '@/lib/email';
import { forwardInboundEmail, EmailForwardNotConfiguredError } from '@/lib/email-forward';
import { env, features } from '@/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type LetterpierWebhookEnvelope = {
  type?: string;
  data?: { email_id?: string; sandbox?: boolean };
};

export async function POST(req: Request): Promise<Response> {
  if (!features.emailInboundForward || !env.LETTERPIER_WEBHOOK_SECRET) {
    return apiError('Inbound email forwarding is not configured.', 503);
  }

  const id = req.headers.get('svix-id');
  const timestamp = req.headers.get('svix-timestamp');
  const signature = req.headers.get('svix-signature');
  if (!id || !timestamp || !signature) {
    return apiError('Missing Svix signature headers.', 400);
  }

  const rawBody = await req.text();
  let event: LetterpierWebhookEnvelope;
  try {
    event = new Webhook(env.LETTERPIER_WEBHOOK_SECRET).verify(rawBody, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    }) as LetterpierWebhookEnvelope;
  } catch {
    return apiError('Invalid Letterpier webhook signature.', 400);
  }

  if (event?.type !== 'email.received' || event.data?.sandbox === true) {
    return Response.json({ ok: true, ignored: event?.type ?? 'unknown' });
  }

  const emailId = event.data?.email_id;
  if (
    typeof emailId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(emailId)
  ) {
    return apiError('Webhook payload missing a valid email_id.', 400);
  }

  try {
    const email = await getInboundEmail(emailId);
    await forwardInboundEmail(email, emailId);
  } catch (err) {
    if (err instanceof EmailForwardNotConfiguredError) {
      return apiError(err.message, 503);
    }
    // Message content and signed attachment URLs must never reach logs.
    console.error('Letterpier inbound forwarding failed.');
    // Any failure must remain retryable by the provider.
    return apiError('Forwarding failed.', 500);
  }

  return Response.json({ ok: true });
}
