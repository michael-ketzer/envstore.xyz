import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Webhook } from 'svix';

import { makeDbMock } from '@/test/db-mock';
import { makeEmailMock } from '@/test/email-mock';
import { makeEnvMock } from '@/test/env-mock';

const secret = `whsec_${Buffer.from('letterpier-webhook-contract-test!').toString('base64')}`;
const emailId = '0f6d2c1e-5a7b-4c0e-9d7e-3b1f8a2c4d60';
const email = { from: 'sender@example.com', to: ['legal@envstore.xyz'], text: 'Message body' };
const fakeGet = mock();
const fakeForward = mock();
const fakeEnv = { LETTERPIER_WEBHOOK_SECRET: secret as string | undefined };
const fakeFeatures = { emailInboundForward: true };

class FakeForwardNotConfigured extends Error {
  constructor() {
    super('Forwarding not configured');
  }
}

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: {} }));
mock.module('@/env', () => makeEnvMock({ env: fakeEnv, features: fakeFeatures }));
mock.module('@/lib/email', () => makeEmailMock({ getInboundEmail: fakeGet }));
mock.module('@/lib/email-forward', () => ({
  forwardInboundEmail: fakeForward,
  EmailForwardNotConfiguredError: FakeForwardNotConfigured,
}));

const { POST } = await import('./route');
const originalConsoleError = console.error;

beforeEach(() => {
  console.error = mock(() => {}) as typeof console.error;
  fakeGet.mockReset();
  fakeForward.mockReset();
  fakeGet.mockResolvedValue(email);
  fakeForward.mockResolvedValue(undefined);
  fakeEnv.LETTERPIER_WEBHOOK_SECRET = secret;
  fakeFeatures.emailInboundForward = true;
});

afterEach(() => {
  console.error = originalConsoleError;
});

function request(
  event: unknown = { type: 'email.received', data: { email_id: emailId } },
  opts: { timestamp?: Date; tamper?: boolean; headers?: Record<string, string> } = {},
): Request {
  const body = JSON.stringify(event);
  const timestamp = opts.timestamp ?? new Date();
  const headers = {
    'svix-id': 'event-contract-test',
    'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'svix-signature': new Webhook(secret).sign('event-contract-test', timestamp, body),
    ...opts.headers,
  };
  return new Request('https://www.envstore.xyz/api/letterpier/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: opts.tamper ? body + ' ' : body,
  });
}

describe('Letterpier webhook configuration and real signature verification', () => {
  test('disabled forwarding and missing secret each return 503', async () => {
    fakeFeatures.emailInboundForward = false;
    expect((await POST(request())).status).toBe(503);
    fakeFeatures.emailInboundForward = true;
    fakeEnv.LETTERPIER_WEBHOOK_SECRET = undefined;
    expect((await POST(request())).status).toBe(503);
    expect(fakeGet).not.toHaveBeenCalled();
  });

  test('missing signature headers return 400', async () => {
    expect((await POST(request(undefined, { headers: { 'svix-id': '' } }))).status).toBe(400);
    expect(fakeGet).not.toHaveBeenCalled();
  });

  test('changed raw body and forged signatures return 400', async () => {
    expect((await POST(request(undefined, { tamper: true }))).status).toBe(400);
    expect(
      (await POST(request(undefined, { headers: { 'svix-signature': 'v1,forged' } }))).status,
    ).toBe(400);
    expect(fakeForward).not.toHaveBeenCalled();
  });

  test('timestamps older than five minutes or in the future return 400', async () => {
    for (const offset of [-360_000, 360_000]) {
      expect(
        (await POST(request(undefined, { timestamp: new Date(Date.now() + offset) }))).status,
      ).toBe(400);
    }
    expect(fakeGet).not.toHaveBeenCalled();
  });
});

describe('Letterpier webhook dispatch and retries', () => {
  test('other events and sandbox receipts are acknowledged without forwarding', async () => {
    for (const event of [
      { type: 'email.delivered', data: {} },
      { type: 'email.received', data: { email_id: emailId, sandbox: true } },
    ]) {
      expect((await POST(request(event))).status).toBe(200);
    }
    expect(fakeGet).not.toHaveBeenCalled();
    expect(fakeForward).not.toHaveBeenCalled();
  });

  test('missing or malformed email IDs return 400', async () => {
    for (const data of [undefined, {}, { email_id: '../../domains' }, { email_id: 123 }]) {
      expect((await POST(request({ type: 'email.received', data }))).status).toBe(400);
    }
    expect(fakeGet).not.toHaveBeenCalled();
  });

  test('valid receipt fetches content and forwards with a stable message ID', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(fakeGet).toHaveBeenCalledWith(emailId);
    expect(fakeForward).toHaveBeenCalledWith(email, emailId);
  });

  test('fetch failure returns 500 without forwarding or leaking provider errors', async () => {
    fakeGet.mockRejectedValueOnce(new Error('private message content and signed URL'));
    expect((await POST(request())).status).toBe(500);
    expect(fakeForward).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Letterpier inbound forwarding failed.');
  });

  test('forwarding not configured returns 503; send failure returns 500 for retry', async () => {
    fakeForward.mockRejectedValueOnce(new FakeForwardNotConfigured());
    expect((await POST(request())).status).toBe(503);
    fakeForward.mockRejectedValueOnce(new Error('sending failed'));
    expect((await POST(request())).status).toBe(500);
  });
});
