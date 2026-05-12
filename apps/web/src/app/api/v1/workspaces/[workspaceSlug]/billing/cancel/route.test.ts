// POST /workspaces/[ws]/billing/cancel — owner-only, "no subscription on file"
// short-circuit (400, not 500), Paddle-not-configured → 503, audit recorded.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { FakeBillingNotConfigured, makePaddleMock } from '@/test/paddle-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  auditLog: { create: mock() },
};

const fakeAuth = mock();
const fakeCancel = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/auth', () => ({ auth: fakeAuth }));
mock.module('@/lib/paddle', () =>
  makePaddleMock({ cancelSubscriptionAtPeriodEnd: fakeCancel }),
);

const { POST } = await import('./route');

beforeEach(() => {
  fakePrisma.workspace.findFirst.mockReset();
  fakePrisma.auditLog.create.mockReset();
  fakeAuth.mockReset();
  fakeCancel.mockReset();
  fakePrisma.auditLog.create.mockResolvedValue({});
});

const ctx = (slug: string) => ({ params: Promise.resolve({ workspaceSlug: slug }) });

function req(slug: string): Request {
  return new Request(`https://envstore.xyz/api/v1/workspaces/${slug}/billing/cancel`, {
    method: 'POST',
  });
}

describe('POST /billing/cancel', () => {
  test('no session → 401', async () => {
    fakeAuth.mockResolvedValueOnce(null);
    expect((await POST(req('acme'), ctx('acme'))).status).toBe(401);
  });

  test('non-owner → 404', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_intruder' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    expect((await POST(req('acme'), ctx('acme'))).status).toBe(404);
    expect(fakeCancel).not.toHaveBeenCalled();
  });

  test('owner without an active Paddle subscription → 400 (no Paddle call)', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      subscription: { paddleSubscriptionId: null },
    });
    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(400);
    expect(fakeCancel).not.toHaveBeenCalled();
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('owner with active subscription → cancels at period end, audit fires', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      subscription: { paddleSubscriptionId: 'sub_p_1' },
    });
    fakeCancel.mockResolvedValueOnce(undefined);

    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(200);
    expect(fakeCancel).toHaveBeenCalledWith('sub_p_1');
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; resourceId: string };
    };
    expect(audit.data.action).toBe('billing.cancel_requested');
    expect(audit.data.resourceId).toBe('sub_p_1');
  });

  test('Paddle not configured → 503', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      subscription: { paddleSubscriptionId: 'sub_p_1' },
    });
    fakeCancel.mockRejectedValueOnce(new FakeBillingNotConfigured());

    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(503);
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
