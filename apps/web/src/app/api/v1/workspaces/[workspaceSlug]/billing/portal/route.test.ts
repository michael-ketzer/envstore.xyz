// GET /workspaces/[ws]/billing/portal — owner-only, requires both a Paddle
// customerId and a subscriptionId before opening the portal, Paddle-not-
// configured → 503.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { FakeBillingNotConfigured, makePaddleMock } from '@/test/paddle-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
};

const fakeAuth = mock();
const fakePortal = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/auth', () => ({ auth: fakeAuth }));
mock.module('@/lib/paddle', () =>
  makePaddleMock({ createCustomerPortalSession: fakePortal }),
);

const { GET } = await import('./route');

beforeEach(() => {
  fakePrisma.workspace.findFirst.mockReset();
  fakeAuth.mockReset();
  fakePortal.mockReset();
});

const ctx = (slug: string) => ({ params: Promise.resolve({ workspaceSlug: slug }) });

function req(slug: string): Request {
  return new Request(`https://envstore.xyz/api/v1/workspaces/${slug}/billing/portal`, {
    method: 'GET',
  });
}

describe('GET /billing/portal', () => {
  test('no session → 401', async () => {
    fakeAuth.mockResolvedValueOnce(null);
    expect((await GET(req('acme'), ctx('acme'))).status).toBe(401);
  });

  test('non-owner → 404', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_intruder' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    expect((await GET(req('acme'), ctx('acme'))).status).toBe(404);
  });

  test('owner without customerId → 400 (cannot open portal pre-subscription)', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      owner: { paddleCustomerId: null },
      subscription: { paddleSubscriptionId: 'sub_p_1' },
    });
    expect((await GET(req('acme'), ctx('acme'))).status).toBe(400);
    expect(fakePortal).not.toHaveBeenCalled();
  });

  test('owner without subscriptionId → 400', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      owner: { paddleCustomerId: 'cus_1' },
      subscription: null,
    });
    expect((await GET(req('acme'), ctx('acme'))).status).toBe(400);
    expect(fakePortal).not.toHaveBeenCalled();
  });

  test('owner with both → 200, returns portal URL scoped to this subscription', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      owner: { paddleCustomerId: 'cus_1' },
      subscription: { paddleSubscriptionId: 'sub_p_1' },
    });
    fakePortal.mockResolvedValueOnce({ overviewUrl: 'https://paddle.example/portal' });

    const res = await GET(req('acme'), ctx('acme'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe('https://paddle.example/portal');

    // The portal session must be scoped to THIS subscription. A workspace
    // owner might own multiple subscriptions on the same Paddle customer;
    // the portal must filter to the one they actually asked about.
    const args = fakePortal.mock.calls[0];
    expect(args?.[0]).toBe('cus_1');
    expect(args?.[1]).toEqual(['sub_p_1']);
  });

  test('Paddle not configured → 503', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({
      id: 'ws_1',
      owner: { paddleCustomerId: 'cus_1' },
      subscription: { paddleSubscriptionId: 'sub_p_1' },
    });
    fakePortal.mockRejectedValueOnce(new FakeBillingNotConfigured());
    expect((await GET(req('acme'), ctx('acme'))).status).toBe(503);
  });
});
