// Run only by email.test.ts, in an isolated process. Every fetch is intercepted.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

process.env.LETTERPIER_API_KEY = 'lp_live_contract_not_a_real_key';
process.env.RESEND_BASE_URL = 'https://obsolete-provider.invalid';
const env = {
  NODE_ENV: 'development',
  LETTERPIER_API_KEY: process.env.LETTERPIER_API_KEY,
  LETTERPIER_BASE_URL: 'https://app.letterpier.com',
  LETTERPIER_FROM: 'envstore <welcome@envstore.xyz>',
  LETTERPIER_INBOUND_FORWARD_TO: 'ops@example.com',
};
const features = { emailOtp: true };
mock.module('server-only', () => ({}));
mock.module('@/env', () => ({ env, features }));
console.error = () => {};

type Call = { url: string; body: Record<string, unknown> | undefined; headers: Headers };
const calls: Call[] = [];
const emailId = '0f6d2c1e-5a7b-4c0e-9d7e-3b1f8a2c4d60';
let failSend = false;
let failGet = false;
let failList = false;
let failDownload = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({
    url,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    headers: new Headers(init?.headers),
  });
  if (url === 'https://app.letterpier.com/emails') {
    return failSend
      ? Response.json(
          { name: 'validation_error', message: 'private provider message' },
          { status: 422 },
        )
      : Response.json({ id: 'sent-message' });
  }
  if (url === `https://app.letterpier.com/emails/receiving/${emailId}`) {
    if (failGet) return Response.json({ name: 'application_error' }, { status: 503 });
    return Response.json({
      id: emailId,
      from: 'Ada <ada@example.com>',
      to: ['legal@envstore.xyz'],
      subject: 'Question',
      text: 'Plain-text body',
      html: '<img src="https://untrusted.invalid/pixel">',
      attachments: [{ id: 'attachment-1', filename: 'note.txt' }],
    });
  }
  if (url === `https://app.letterpier.com/emails/receiving/${emailId}/attachments`) {
    if (failList) return Response.json({ name: 'application_error' }, { status: 503 });
    return Response.json({
      data: [
        {
          id: 'attachment-1',
          filename: 'note.txt',
          content_type: 'text/plain',
          download_url: 'https://downloads.example.com/signed-file',
        },
      ],
    });
  }
  if (url === 'https://downloads.example.com/signed-file') {
    return failDownload ? new Response(null, { status: 503 }) : new Response('attachment bytes');
  }
  throw new Error('Unexpected network destination in the mail contract');
}) as typeof fetch;

const {
  sendOtpEmail,
  sendInviteEmail,
  sendEmail,
  getInboundEmail,
  EmailDeliveryError,
  EmailNotConfiguredError,
} = await import('../src/lib/email');
const { forwardInboundEmail } = await import('../src/lib/email-forward');

await sendOtpEmail('user@example.com', '123456');
assert.equal(calls[0]?.url, 'https://app.letterpier.com/emails');
assert.equal(calls[0]?.body?.from, env.LETTERPIER_FROM);
assert.equal(calls[0]?.body?.to, 'user@example.com');
assert.equal(calls[0]?.body?.subject, 'Your envstore login code');
assert.match(String(calls[0]?.body?.text), /123456/);
assert.match(String(calls[0]?.body?.html), /123456/);
assert.ok(!String(calls[0]?.body?.subject).includes('123456'));
assert.equal(calls[0]?.headers.get('authorization'), 'Bearer lp_live_contract_not_a_real_key');

await sendInviteEmail({
  to: 'invitee@example.com',
  workspaceName: 'Workspace',
  inviterName: 'Ada',
  acceptUrl: 'https://www.envstore.xyz/invite/contract',
});
assert.equal(calls[1]?.body?.to, 'invitee@example.com');
assert.equal(calls[1]?.body?.subject, 'Ada invited you to "Workspace" on envstore');
assert.match(String(calls[1]?.body?.text), /https:\/\/www\.envstore\.xyz\/invite\/contract/);

const received = await getInboundEmail(emailId);
assert.equal(received.text, 'Plain-text body');
assert.equal(
  Buffer.from(received.attachments?.[0]?.content ?? '', 'base64').toString(),
  'attachment bytes',
);
assert.equal(
  calls
    .find((call) => call.url.startsWith('https://downloads.example.com'))
    ?.headers.get('authorization'),
  null,
);
await forwardInboundEmail(received, emailId);
const forwarded = calls.at(-1)!;
assert.equal(forwarded.body?.from, env.LETTERPIER_FROM);
assert.equal(forwarded.body?.to, 'ops@example.com');
assert.equal(forwarded.body?.reply_to, 'Ada <ada@example.com>');
assert.equal(forwarded.body?.subject, '[fwd] Question');
assert.equal(
  forwarded.body?.text,
  '── Forwarded from envstore inbound ──\nFrom: Ada <ada@example.com>\nTo:   legal@envstore.xyz\nSubj: Question\nPlain-text body',
);
assert.equal(forwarded.body?.html, undefined);
assert.equal(forwarded.headers.get('idempotency-key'), `inbound:${emailId}`);
assert.deepEqual(forwarded.body?.attachments, [
  {
    filename: 'note.txt',
    content: Buffer.from('attachment bytes').toString('base64'),
    content_type: 'text/plain',
  },
]);

await forwardInboundEmail(received, emailId);
assert.equal(
  calls.at(-1)?.headers.get('idempotency-key'),
  forwarded.headers.get('idempotency-key'),
);
await forwardInboundEmail(
  { ...received, from: 'attacker@example.com\r\nBcc: other@example.com' },
  emailId,
);
assert.equal(calls.at(-1)?.body?.reply_to, undefined);

failSend = true;
await assert.rejects(() => sendOtpEmail('user@example.com', '654321'), EmailDeliveryError);
await assert.rejects(
  () =>
    sendEmail(
      { from: env.LETTERPIER_FROM, to: 'user@example.com', subject: 'Contract', text: 'Body' },
      { idempotencyKey: 'contract-key' },
    ),
  { message: 'Email delivery failed.' },
);
assert.equal(calls.at(-1)?.headers.get('idempotency-key'), 'contract-key');
failSend = false;
failGet = true;
await assert.rejects(() => getInboundEmail(emailId), EmailDeliveryError);
failGet = false;
failList = true;
await assert.rejects(() => getInboundEmail(emailId), EmailDeliveryError);
failList = false;
failDownload = true;
await assert.rejects(() => getInboundEmail(emailId), EmailDeliveryError);

let warned = false;
console.warn = () => {
  warned = true;
};
features.emailOtp = false;
env.NODE_ENV = 'production';
await assert.rejects(() => sendOtpEmail('user@example.com', '654321'), EmailNotConfiguredError);
await assert.rejects(
  () =>
    sendInviteEmail({
      to: 'invitee@example.com',
      workspaceName: 'Workspace',
      inviterName: 'Ada',
      acceptUrl: 'https://www.envstore.xyz/invite/contract',
    }),
  EmailNotConfiguredError,
);
assert.equal(warned, false);
env.NODE_ENV = 'development';
await sendOtpEmail('user@example.com', '654321');
assert.equal(warned, true);
