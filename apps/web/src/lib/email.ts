import 'server-only';
import { Resend, type CreateEmailOptions, type CreateEmailRequestOptions } from 'resend';

import { env, features } from '@/env';
import type { InboundEmail } from './email-forward';

const mail = env.LETTERPIER_API_KEY
  ? new Resend(process.env.LETTERPIER_API_KEY, { baseUrl: env.LETTERPIER_BASE_URL })
  : null;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured.');
    this.name = 'EmailNotConfiguredError';
  }
}

export class EmailDeliveryError extends Error {
  constructor() {
    // Provider errors can contain message content. Keep them out of logs.
    super('Email delivery failed.');
    this.name = 'EmailDeliveryError';
  }
}

export async function sendEmail(
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions,
): Promise<void> {
  if (!mail) throw new EmailNotConfiguredError();
  const { data, error } = await mail.emails.send(payload, options);
  // The SDK returns API errors rather than throwing. Surface failures so
  // callers and webhook retries never acknowledge an unsuccessful send.
  if (error || !data?.id) throw new EmailDeliveryError();
}

export async function getInboundEmail(emailId: string): Promise<InboundEmail> {
  if (!mail) throw new EmailNotConfiguredError();
  const { data, error } = await mail.emails.receiving.get(emailId);
  if (error || !data) throw new EmailDeliveryError();

  const attachments: NonNullable<InboundEmail['attachments']> = [];
  if (data.attachments?.length) {
    const result = await mail.emails.receiving.attachments.list({ emailId });
    if (result.error || !result.data) throw new EmailDeliveryError();
    for (const attachment of result.data.data) {
      // Download URLs come from the authenticated provider response, not
      // from untrusted webhook input. Never send our API key to these URLs.
      let response: Response;
      try {
        response = await fetch(attachment.download_url);
      } catch {
        throw new EmailDeliveryError();
      }
      if (!response.ok) throw new EmailDeliveryError();
      attachments.push({
        filename: attachment.filename,
        content: Buffer.from(await response.arrayBuffer()).toString('base64'),
        contentType: attachment.content_type,
      });
    }
  }

  return {
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text,
    html: data.html,
    attachments,
  };
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!features.emailOtp || !env.LETTERPIER_FROM) {
    if (env.NODE_ENV === 'production') throw new EmailNotConfiguredError();
    // Dev fallback: print the code so the dev can log in without email configured.
    console.warn(`[envstore-dev] OTP for ${to}: ${code}`);
    return;
  }
  await sendEmail({
    from: env.LETTERPIER_FROM,
    to,
    // Code lives in the body only. Subject lines leak into mail-server logs,
    // OS-level notification previews, and lock-screen banners — putting the
    // OTP there would let anyone in line-of-sight or with a paired device
    // read it without unlocking.
    subject: 'Your envstore login code',
    text: [
      `Your envstore login code is: ${code}`,
      ``,
      `It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    ].join('\n'),
    html: `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:480px;margin:32px auto;color:#0f172a;">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px;">envstore login code</h1>
  <p style="margin:0 0 12px;">Use this code to finish signing in:</p>
  <p style="font-family:ui-monospace,SF Mono,monospace;font-size:32px;font-weight:600;letter-spacing:6px;background:#f1f5f9;padding:16px 24px;display:inline-block;border-radius:8px;">${code}</p>
  <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
</body></html>`,
  });
}

export async function sendInviteEmail(opts: {
  to: string;
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
}): Promise<void> {
  if (!features.emailOtp || !env.LETTERPIER_FROM) {
    if (env.NODE_ENV === 'production') throw new EmailNotConfiguredError();
    console.warn(`[envstore-dev] Invite to ${opts.to}: ${opts.acceptUrl}`);
    return;
  }
  await sendEmail({
    from: env.LETTERPIER_FROM,
    to: opts.to,
    subject: `${opts.inviterName} invited you to "${opts.workspaceName}" on envstore`,
    text: [
      `${opts.inviterName} invited you to the workspace "${opts.workspaceName}" on envstore.`,
      ``,
      `Accept the invite: ${opts.acceptUrl}`,
    ].join('\n'),
  });
}
