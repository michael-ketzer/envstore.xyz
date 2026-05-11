// Inbound email forwarder. Resend's `email.received` webhook gives us the
// parsed message; this module re-sends it via Resend's outbound API to the
// address in RESEND_INBOUND_FORWARD_TO.
//
// Why re-send instead of plain forwarding via an MX route? Because Resend's
// inbound mailbox is webhook-only — there's no SMTP "deliver to" target. The
// outbound send uses our own verified domain as the From: address (required by
// every receiving MTA's SPF/DMARC) and stuffs the original sender into
// Reply-To so a "Reply" in the user's mail client goes to the right place.
import 'server-only';
import { Resend } from 'resend';

import { env } from '@/env';

// Shape we accept from the Resend `email.received` webhook payload. Defined
// permissively because Resend's inbound schema is young and may add fields.
export type InboundEmail = {
  from?: string | { email?: string; name?: string } | null;
  to?: string[] | string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  attachments?: Array<{
    filename?: string;
    content?: string; // base64
    contentType?: string;
  }> | null;
};

export class EmailForwardNotConfiguredError extends Error {
  constructor() {
    super('Inbound email forwarding is not configured.');
    this.name = 'EmailForwardNotConfiguredError';
  }
}

export async function forwardInboundEmail(data: InboundEmail): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  const to = env.RESEND_INBOUND_FORWARD_TO;
  if (!apiKey || !from || !to) {
    throw new EmailForwardNotConfiguredError();
  }

  const originalFrom = pickAddress(data.from) ?? 'unknown sender';
  const originalTo = Array.isArray(data.to)
    ? data.to.join(', ')
    : (data.to ?? 'unknown recipient');
  const subject = (data.subject ?? '').trim() || '(no subject)';
  const text = (data.text ?? '').toString();
  const html = data.html ? data.html.toString() : null;

  const meta = [
    `── Forwarded from envstore inbound ──`,
    `From: ${originalFrom}`,
    `To:   ${originalTo}`,
    `Subj: ${subject}`,
    '',
  ].join('\n');

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to,
    // Reply in the user's mail client goes to the original sender, not us.
    replyTo: pickAddress(data.from) ?? undefined,
    subject: `[fwd] ${subject}`,
    text: meta + text,
    html: html
      ? [
          `<div style="border-left:3px solid #ccc;padding:0 0 0 12px;color:#666;font-size:12px;margin-bottom:16px;font-family:ui-monospace,SF Mono,monospace;">`,
          `Forwarded from envstore inbound<br>`,
          `From: ${escapeHtml(originalFrom)}<br>`,
          `To: ${escapeHtml(originalTo)}<br>`,
          `Subject: ${escapeHtml(subject)}`,
          `</div>`,
          html,
        ].join('')
      : undefined,
    attachments: normalizeAttachments(data.attachments ?? null),
  });
}

function pickAddress(
  v: InboundEmail['from'],
): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.email ?? null;
}

function normalizeAttachments(
  atts: NonNullable<InboundEmail['attachments']> | null,
): Array<{ filename: string; content: Buffer; contentType?: string }> | undefined {
  if (!atts || atts.length === 0) return undefined;
  const out: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
  for (const a of atts) {
    if (!a.filename || !a.content) continue;
    try {
      out.push({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.contentType,
      });
    } catch {
      // Skip malformed attachments rather than fail the whole forward.
    }
  }
  return out.length ? out : undefined;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}
