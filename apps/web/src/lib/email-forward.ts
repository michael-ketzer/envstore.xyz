// Re-send received mail through the central Letterpier helper, from our
// verified domain. Reply-To preserves the original sender for mailbox replies.
import 'server-only';

import { env } from '@/env';
import { sendEmail } from './email';

// Message content fetched from Letterpier's authenticated receiving API.
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

// Loose email-address sanity check — refuses obvious header-injection
// attempts (CR/LF) and anything that doesn't look like a single address.
// Letterpier's API does its own validation, but we don't want to pass through
// untrusted-but-syntactically-valid input that nonetheless looks weird.
function looksLikeEmailAddress(raw: string): boolean {
  if (raw.length === 0 || raw.length > 320) return false;
  // The literal NUL in this character class is exactly what we want to
  // refuse (header-injection / smuggling defense), not an accidental
  // typo — the lint rule meant to catch the latter doesn't apply.
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\x00]/.test(raw)) return false;
  // Bare `local@host` form, or `Display Name <local@host>`.
  return /^[^<>]*<[^<>@\s]+@[^<>@\s]+>\s*$|^[^<>@\s]+@[^<>@\s]+$/.test(raw);
}

export async function forwardInboundEmail(data: InboundEmail, emailId: string): Promise<void> {
  const apiKey = env.LETTERPIER_API_KEY;
  const from = env.LETTERPIER_FROM;
  const to = env.LETTERPIER_INBOUND_FORWARD_TO;
  if (!apiKey || !from || !to) {
    throw new EmailForwardNotConfiguredError();
  }

  const rawFrom = pickAddress(data.from);
  const originalFrom = rawFrom ?? 'unknown sender';
  const originalTo = Array.isArray(data.to) ? data.to.join(', ') : (data.to ?? 'unknown recipient');
  const subject = (data.subject ?? '').trim() || '(no subject)';
  const text = (data.text ?? '').toString();

  // Only pass reply-to if it parses as a single email address. Untrusted
  // input must not become an injected outbound header.
  const replyTo = rawFrom && looksLikeEmailAddress(rawFrom) ? rawFrom : undefined;

  const meta = [
    `── Forwarded from envstore inbound ──`,
    `From: ${originalFrom}`,
    `To:   ${originalTo}`,
    `Subj: ${subject}`,
    '',
  ].join('\n');

  // Deliberately drop the HTML body. Attacker-controlled HTML in the
  // forward turned the admin inbox into a phishing surface — branded
  // links, tracking pixels, and quirks that some mail clients still
  // render. Plaintext-only forwarding keeps fidelity for the admin while
  // removing every active-content vector. If the original HTML is needed
  // for an investigation, it's still available in Letterpier's dashboard.
  await sendEmail(
    {
      from,
      to,
      replyTo,
      subject: `[fwd] ${subject}`,
      text: meta + text,
      attachments: normalizeAttachments(data.attachments ?? null),
    },
    // Retries and replays of the same received message share a send key.
    { idempotencyKey: `inbound:${emailId}` },
  );
}

function pickAddress(v: InboundEmail['from']): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.email ?? null;
}

function normalizeAttachments(
  atts: NonNullable<InboundEmail['attachments']> | null,
): Array<{ filename: string; content: string; contentType?: string }> | undefined {
  if (!atts || atts.length === 0) return undefined;
  const out: Array<{ filename: string; content: string; contentType?: string }> = [];
  for (const a of atts) {
    if (!a.filename || !a.content) continue;
    try {
      out.push({
        filename: a.filename,
        // The SDK passes attachment content through unchanged. Letterpier
        // requires base64 strings, rather than JSON-serialized Buffers.
        content: Buffer.from(a.content, 'base64').toString('base64'),
        contentType: a.contentType,
      });
    } catch {
      // Skip malformed attachments rather than fail the whole forward.
    }
  }
  return out.length ? out : undefined;
}
