// Tests for the Paddle webhook handler. The F4 fix splits the row's single
// timestamp into receivedAt (insert) + processedAt (set only after dispatch
// succeeds), and serializes parallel duplicate deliveries via a Postgres
// transaction-scoped advisory lock. These tests pin both: fresh deliveries
// insert with processedAt null, processedAt is set only after dispatch
// returns, duplicates with processedAt null re-run dispatch, and the
// advisory lock is acquired before any other work happens inside the
// transaction.
//
// We mock @envstore/db (paddleWebhookEvent + subscription methods, plus
// $transaction + $executeRaw) and the Paddle SDK verify function so the
// tests run without a database. The $transaction mock invokes the callback
// with the same fakePrisma stub, so behavior under the lock mirrors what
// the route would see in production.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { FakePrismaKnownError, makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  paddleWebhookEvent: {
    create: mock(),
    findUnique: mock(),
    update: mock(),
  },
  subscription: {
    upsert: mock(),
  },
  auditLog: {
    create: mock(),
  },
  // $executeRaw is the path the SUT uses to call pg_advisory_xact_lock.
  // Tests assert it was invoked with the expected SQL fragment. It returns
  // a number in real Prisma (rows affected); 0 is fine for our purposes.
  $executeRaw: mock(),
  // $transaction is the interactive form: it receives an async callback
  // and an options bag. Our mock invokes the callback with this same
  // fakePrisma so the route's `tx.X` calls hit our stubs directly.
  $transaction: mock(async (cb: (tx: typeof fakePrisma) => Promise<unknown>) => {
    return cb(fakePrisma);
  }),
};

const fakeVerify = mock();
const originalConsoleError = console.error;

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/paddle', () => ({
  verifyAndParseWebhook: fakeVerify,
  BillingNotConfiguredError: class extends Error {},
}));

const { POST } = await import('./route');

beforeEach(() => {
  console.error = mock(() => {}) as typeof console.error;
  fakePrisma.paddleWebhookEvent.create.mockReset();
  fakePrisma.paddleWebhookEvent.findUnique.mockReset();
  fakePrisma.paddleWebhookEvent.update.mockReset();
  fakePrisma.subscription.upsert.mockReset();
  fakePrisma.auditLog.create.mockReset();
  fakePrisma.$executeRaw.mockReset();
  fakePrisma.$executeRaw.mockResolvedValue(0);
  // Re-arm the $transaction stub each test — mockReset would wipe the
  // implementation that proxies the callback.
  fakePrisma.$transaction.mockReset();
  fakePrisma.$transaction.mockImplementation(
    async (cb: (tx: typeof fakePrisma) => Promise<unknown>) => cb(fakePrisma),
  );
  fakeVerify.mockReset();
});

afterEach(() => {
  console.error = originalConsoleError;
});

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('https://envstore.xyz/api/paddle/webhook', {
    method: 'POST',
    headers: { 'paddle-signature': 'sig-stub', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function subscriptionEvent(eventId = 'evt_test_1') {
  return {
    eventId,
    eventType: 'subscription.activated',
    data: {
      id: 'sub_1',
      status: 'active',
      items: [{ price: { id: 'pri_1' } }],
      currentBillingPeriod: { endsAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() },
      canceledAt: null,
      customData: { workspaceId: 'ws_1' },
    },
  };
}

describe('Paddle webhook — F4 receivedAt/processedAt state machine', () => {
  test('happy path: lock, insert, dispatch, then stamp processedAt — in that order', async () => {
    const event = subscriptionEvent();
    const order: string[] = [];
    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.$executeRaw.mockImplementationOnce(async () => {
      order.push('lock');
      return 0;
    });
    fakePrisma.paddleWebhookEvent.findUnique.mockImplementationOnce(async () => {
      order.push('find');
      return null;
    });
    fakePrisma.paddleWebhookEvent.create.mockImplementationOnce(async () => {
      order.push('insert');
      return {};
    });
    fakePrisma.subscription.upsert.mockImplementationOnce(async () => {
      order.push('dispatch:subscription');
      return {};
    });
    fakePrisma.auditLog.create.mockImplementationOnce(async () => {
      order.push('dispatch:audit');
      return {};
    });
    fakePrisma.paddleWebhookEvent.update.mockImplementationOnce(async () => {
      order.push('stamp');
      return {};
    });

    const res = await POST(buildRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // The advisory lock must fire BEFORE findUnique/create/dispatch. This is
    // the actual race fix: the lock has to wrap the read of processedAt, not
    // just the final write.
    expect(order).toEqual([
      'lock',
      'find',
      'insert',
      'dispatch:subscription',
      'dispatch:audit',
      'stamp',
    ]);
    expect(fakePrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fakePrisma.paddleWebhookEvent.findUnique).toHaveBeenCalledTimes(1);
    expect(fakePrisma.paddleWebhookEvent.create).toHaveBeenCalledTimes(1);
    expect(fakePrisma.subscription.upsert).toHaveBeenCalledTimes(1);
    expect(fakePrisma.paddleWebhookEvent.update).toHaveBeenCalledTimes(1);

    // Row was inserted with processedAt left null — the field is omitted
    // from `data` so Prisma uses the schema default (nullable, no default
    // → null at insert).
    const createCall = fakePrisma.paddleWebhookEvent.create.mock.calls[0]![0];
    expect(createCall.data.eventId).toBe(event.eventId);
    expect(createCall.data.processedAt).toBeUndefined();

    // The stamp landed last.
    const stampCall = fakePrisma.paddleWebhookEvent.update.mock.calls[0]![0];
    expect(stampCall.where).toEqual({ eventId: event.eventId });
    expect(stampCall.data.processedAt).toBeInstanceOf(Date);

    const auditCall = fakePrisma.auditLog.create.mock.calls[0]![0];
    expect(auditCall.data.workspaceId).toBe('ws_1');
    expect(auditCall.data.action).toBe('billing.subscription.activated');
    expect(auditCall.data.resourceId).toBe('sub_1');
  });

  test('advisory lock SQL references hashtext(eventId) — strict serialization key', async () => {
    // Regression guard for the F4-second-pass fix: two parallel deliveries
    // of the same eventId must serialize. The serialization is keyed on
    // the eventId via Postgres's transaction-scoped advisory lock; if a
    // future refactor accidentally drops the lock or keys it on the wrong
    // value, this test fails loudly.
    const event = subscriptionEvent();
    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce(null);
    fakePrisma.paddleWebhookEvent.create.mockResolvedValueOnce({});
    fakePrisma.subscription.upsert.mockResolvedValueOnce({});
    fakePrisma.auditLog.create.mockResolvedValueOnce({});
    fakePrisma.paddleWebhookEvent.update.mockResolvedValueOnce({});

    await POST(buildRequest({}));

    // Prisma's tagged-template form passes a TemplateStringsArray as
    // arg[0] and the interpolated values as the rest. We assert both the
    // SQL fragment ("pg_advisory_xact_lock(hashtext(") and the bound
    // argument (the event id).
    const [sqlFragments, ...args] = fakePrisma.$executeRaw.mock.calls[0]!;
    expect(sqlFragments.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(args).toEqual([event.eventId]);
  });

  test('duplicate with processedAt set → deduplicates (the genuine-retry case)', async () => {
    const event = subscriptionEvent();
    fakeVerify.mockResolvedValueOnce(event);
    // Inside the lock we see an existing row that finished successfully.
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce({
      processedAt: new Date(),
    });

    const res = await POST(buildRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduplicated: true });

    // Crucially: dispatch did NOT re-fire and no row insert happened.
    expect(fakePrisma.paddleWebhookEvent.create).not.toHaveBeenCalled();
    expect(fakePrisma.subscription.upsert).not.toHaveBeenCalled();
    expect(fakePrisma.paddleWebhookEvent.update).not.toHaveBeenCalled();
  });

  test('duplicate with processedAt: null → re-runs dispatch (the failed-handler retry case)', async () => {
    // The previous delivery inserted the row but crashed before stamping
    // processedAt. The next retry, holding the lock now, must re-dispatch.
    const event = subscriptionEvent();
    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce({
      processedAt: null,
    });
    // The row exists, so create is NOT called this time around — we go
    // straight from findUnique to dispatch.
    fakePrisma.subscription.upsert.mockResolvedValueOnce({});
    fakePrisma.auditLog.create.mockResolvedValueOnce({});
    fakePrisma.paddleWebhookEvent.update.mockResolvedValueOnce({});

    const res = await POST(buildRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(fakePrisma.paddleWebhookEvent.create).not.toHaveBeenCalled();
    expect(fakePrisma.subscription.upsert).toHaveBeenCalledTimes(1);
    expect(fakePrisma.paddleWebhookEvent.update).toHaveBeenCalledTimes(1);
  });

  test('dispatch failure rolls back the transaction (no half-state, processedAt unset)', async () => {
    const event = subscriptionEvent();
    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce(null);
    fakePrisma.paddleWebhookEvent.create.mockResolvedValueOnce({});
    fakePrisma.subscription.upsert.mockRejectedValueOnce(new Error('boom'));

    const res = await POST(buildRequest({}));
    expect(res.status).toBe(500);

    // processedAt is never stamped on failure. The real DB rolls the
    // create back too; the mock can't simulate that, but in the next
    // retry the lock is re-acquired cleanly because the prior tx ended.
    expect(fakePrisma.paddleWebhookEvent.update).not.toHaveBeenCalled();
  });

  test('fresh dispatch failure can be retried from a clean slate', async () => {
    const event = subscriptionEvent('evt_retry_clean');

    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce(null);
    fakePrisma.paddleWebhookEvent.create.mockResolvedValueOnce({});
    fakePrisma.subscription.upsert.mockRejectedValueOnce(new Error('boom'));

    const first = await POST(buildRequest({}));
    expect(first.status).toBe(500);

    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce(null);
    fakePrisma.paddleWebhookEvent.create.mockResolvedValueOnce({});
    fakePrisma.subscription.upsert.mockResolvedValueOnce({});
    fakePrisma.auditLog.create.mockResolvedValueOnce({});
    fakePrisma.paddleWebhookEvent.update.mockResolvedValueOnce({});

    const retry = await POST(buildRequest({}));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true });

    // Because the first transaction rolled back, the retry sees no existing
    // row and creates the idempotency row again before dispatching.
    expect(fakePrisma.paddleWebhookEvent.findUnique).toHaveBeenCalledTimes(2);
    expect(fakePrisma.paddleWebhookEvent.create).toHaveBeenCalledTimes(2);
    expect(fakePrisma.subscription.upsert).toHaveBeenCalledTimes(2);
    expect(fakePrisma.paddleWebhookEvent.update).toHaveBeenCalledTimes(1);
  });

  test('unexpected create P2002 inside the lock → 500 (fail closed, never silent-dedup)', async () => {
    // The advisory lock makes concurrent inserts of the same eventId
    // impossible at the DB level, so a P2002 here would mean something
    // truly unexpected (lock dropped, DB-level constraint reshape, etc.).
    // The route MUST NOT silently dedupe in that case — bubble out as a
    // 500 so a real problem isn't masked.
    const event = subscriptionEvent();
    fakeVerify.mockResolvedValueOnce(event);
    fakePrisma.paddleWebhookEvent.findUnique.mockResolvedValueOnce(null);
    fakePrisma.paddleWebhookEvent.create.mockRejectedValueOnce(
      new FakePrismaKnownError('P2002'),
    );

    const res = await POST(buildRequest({}));
    expect(res.status).toBe(500);
    expect(fakePrisma.subscription.upsert).not.toHaveBeenCalled();
    expect(fakePrisma.paddleWebhookEvent.update).not.toHaveBeenCalled();
  });

  test('missing Paddle-Signature header → 400 without touching prisma', async () => {
    const noSig = new Request('https://envstore.xyz/api/paddle/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await POST(noSig);
    expect(res.status).toBe(400);
    expect(fakePrisma.$transaction).not.toHaveBeenCalled();
    expect(fakeVerify).not.toHaveBeenCalled();
  });

  test('bad signature → 400 (do-not-retry) and the transaction is never opened', async () => {
    fakeVerify.mockRejectedValueOnce(new Error('bad sig'));
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
    expect(fakePrisma.$transaction).not.toHaveBeenCalled();
  });
});
