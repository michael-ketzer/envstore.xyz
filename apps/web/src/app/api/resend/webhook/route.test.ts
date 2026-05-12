// POST /api/resend/webhook — Resend inbound-email webhook.
//
// Three things matter:
//   - Signature verification (Svix). A bad/missing signature must NOT reach
//     the forwarding step.
//   - Non-email.received events get a 200 ack (Resend stops retrying).
//   - Forwarding failures return 5xx so Resend retries.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const fakeVerify = mock();
const fakeForward = mock();

class FakeForwardNotConfigured extends Error {
  constructor() {
    super('Forwarding not configured');
    this.name = 'EmailForwardNotConfiguredError';
  }
}

const fakeEnv = {
  RESEND_WEBHOOK_SECRET: 'whsec_test' as string | undefined,
  RESEND_INBOUND_FORWARD_TO: 'ops@example.com' as string | undefined,
};
const fakeFeatures = { emailInboundForward: true };

import { makeDbMock } from '@/test/db-mock';
import { makeEnvMock } from '@/test/env-mock';

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: {} }));
mock.module('@/env', () => makeEnvMock({ env: fakeEnv, features: fakeFeatures }));
mock.module('@/lib/email-forward', () => ({
  forwardInboundEmail: fakeForward,
  EmailForwardNotConfiguredError: FakeForwardNotConfigured,
}));
mock.module('svix', () => ({
  Webhook: class {
    constructor(_secret: string) {}
    verify(...args: unknown[]) {
      return fakeVerify(...args);
    }
  },
}));

const originalConsoleError = console.error;

const { POST } = await import('./route');

beforeEach(() => {
  console.error = mock(() => {}) as typeof console.error;
  fakeVerify.mockReset();
  fakeForward.mockReset();
  fakeEnv.RESEND_WEBHOOK_SECRET = 'whsec_test';
  fakeFeatures.emailInboundForward = true;
});

afterEach(() => {
  console.error = originalConsoleError;
});

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://envstore.xyz/api/resend/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const VALID_SVIX_HEADERS = {
  'svix-id': 'msg_123',
  'svix-timestamp': String(Math.floor(Date.now() / 1000)),
  'svix-signature': 'v1,fakesig',
};

describe('POST /resend/webhook — configuration gates', () => {
  test('feature flag off → 503, never invokes Svix verify', async () => {
    fakeFeatures.emailInboundForward = false;
    const res = await POST(req('{}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(503);
    expect(fakeVerify).not.toHaveBeenCalled();
  });

  test('RESEND_WEBHOOK_SECRET unset → 503', async () => {
    fakeEnv.RESEND_WEBHOOK_SECRET = undefined;
    const res = await POST(req('{}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(503);
    expect(fakeVerify).not.toHaveBeenCalled();
  });
});

describe('POST /resend/webhook — signature verification', () => {
  test('missing svix-id → 400, never invokes verify', async () => {
    const res = await POST(req('{}', { 'svix-timestamp': '1', 'svix-signature': 'sig' }));
    expect(res.status).toBe(400);
    expect(fakeVerify).not.toHaveBeenCalled();
  });

  test('verify throws → 400, never reaches forwarder', async () => {
    fakeVerify.mockImplementationOnce(() => {
      throw new Error('bad signature');
    });
    const res = await POST(req('{"type":"email.received"}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(400);
    expect(fakeForward).not.toHaveBeenCalled();
  });
});

describe('POST /resend/webhook — event dispatch', () => {
  test('non-email.received event → 200 ack, no forward', async () => {
    fakeVerify.mockReturnValueOnce({ type: 'email.sent', data: {} });
    const res = await POST(req('{"type":"email.sent"}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ignored: string };
    expect(body.ok).toBe(true);
    expect(body.ignored).toBe('email.sent');
    expect(fakeForward).not.toHaveBeenCalled();
  });

  test('email.received with missing data → 400', async () => {
    fakeVerify.mockReturnValueOnce({ type: 'email.received' });
    const res = await POST(req('{"type":"email.received"}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(400);
    expect(fakeForward).not.toHaveBeenCalled();
  });

  test('email.received with data → forward + 200', async () => {
    fakeVerify.mockReturnValueOnce({
      type: 'email.received',
      data: { from: 'a@b', to: 'legal@envstore.xyz', subject: 'Hi', text: 'body' },
    });
    fakeForward.mockResolvedValueOnce(undefined);
    const res = await POST(req('{}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(200);
    expect(fakeForward).toHaveBeenCalledTimes(1);
  });

  test('forwarder not-configured → 503', async () => {
    fakeVerify.mockReturnValueOnce({
      type: 'email.received',
      data: { from: 'a@b', to: 'legal@envstore.xyz' },
    });
    fakeForward.mockRejectedValueOnce(new FakeForwardNotConfigured());
    const res = await POST(req('{}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(503);
  });

  test('forwarder throws unexpected error → 500 (Resend retries)', async () => {
    fakeVerify.mockReturnValueOnce({
      type: 'email.received',
      data: { from: 'a@b', to: 'legal@envstore.xyz' },
    });
    fakeForward.mockRejectedValueOnce(new Error('SMTP down'));
    const res = await POST(req('{}', VALID_SVIX_HEADERS));
    expect(res.status).toBe(500);
  });
});
