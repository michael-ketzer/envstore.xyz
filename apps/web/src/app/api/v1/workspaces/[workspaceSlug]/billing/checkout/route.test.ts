// POST /workspaces/[ws]/billing/checkout — owner-only gate, "me" shortcut,
// Paddle-not-configured → 503.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';
import { FakeBillingNotConfigured, makePaddleMock } from '@/test/paddle-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  user: { findUnique: mock() },
};

const fakeAuth = mock();
const fakeEnsureCustomer = mock();
const fakeCreateCheckout = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/auth', () => ({ auth: fakeAuth }));
mock.module('@/lib/paddle', () =>
  makePaddleMock({
    ensurePaddleCustomer: fakeEnsureCustomer,
    createWorkspaceCheckout: fakeCreateCheckout,
  }),
);

const { POST } = await import('./route');

beforeEach(() => {
  fakePrisma.workspace.findFirst.mockReset();
  fakePrisma.user.findUnique.mockReset();
  fakeAuth.mockReset();
  fakeEnsureCustomer.mockReset();
  fakeCreateCheckout.mockReset();
});

const ctx = (slug: string) => ({ params: Promise.resolve({ workspaceSlug: slug }) });

function req(slug: string): Request {
  return new Request(`https://envstore.xyz/api/v1/workspaces/${slug}/billing/checkout`, {
    method: 'POST',
  });
}

describe('POST /billing/checkout — auth + ownership', () => {
  test('no session → 401', async () => {
    fakeAuth.mockResolvedValueOnce(null);
    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(401);
    expect(fakePrisma.workspace.findFirst).not.toHaveBeenCalled();
  });

  test('signed in but not the owner → 404 (no existence leak)', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_intruder' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(404);
    // The ownerId filter is the gate — only the owner can reach the Paddle call.
    const args = fakePrisma.workspace.findFirst.mock.calls[0]?.[0] as {
      where: { ownerId: string };
    };
    expect(args.where.ownerId).toBe('u_intruder');
    expect(fakeEnsureCustomer).not.toHaveBeenCalled();
  });

  test('workspaceSlug "me" → resolves caller\'s personal workspace', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_personal' });
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_1',
      email: 'a@b.c',
      name: null,
      paddleCustomerId: null,
    });
    fakeEnsureCustomer.mockResolvedValueOnce('cus_1');
    fakeCreateCheckout.mockResolvedValueOnce({ transactionId: 'txn_1' });

    const res = await POST(req('me'), ctx('me'));
    expect(res.status).toBe(200);

    const args = fakePrisma.workspace.findFirst.mock.calls[0]?.[0] as {
      where: { ownerId: string; type: string; deletedAt: null };
    };
    expect(args.where.ownerId).toBe('u_1');
    expect(args.where.type).toBe('PERSONAL');
    expect(args.where.deletedAt).toBeNull();
  });
});

describe('POST /billing/checkout — paddle integration', () => {
  test('owner → 200, returns transactionId + customerId', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1' });
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_1',
      email: 'a@b.c',
      name: null,
      paddleCustomerId: null,
    });
    fakeEnsureCustomer.mockResolvedValueOnce('cus_1');
    fakeCreateCheckout.mockResolvedValueOnce({ transactionId: 'txn_1' });

    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactionId: string; customerId: string };
    expect(body).toEqual({ transactionId: 'txn_1', customerId: 'cus_1' });

    const checkoutArgs = fakeCreateCheckout.mock.calls[0]?.[0] as {
      workspaceId: string;
      customerId: string;
    };
    expect(checkoutArgs.workspaceId).toBe('ws_1');
    expect(checkoutArgs.customerId).toBe('cus_1');
  });

  test('Paddle not configured → 503 (not 500)', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1' });
    fakePrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u_1',
      email: 'a@b.c',
      name: null,
      paddleCustomerId: null,
    });
    fakeEnsureCustomer.mockRejectedValueOnce(new FakeBillingNotConfigured());

    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(503);
  });

  test('user row missing (race after session check) → 404', async () => {
    fakeAuth.mockResolvedValueOnce({ user: { id: 'u_1' } });
    fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1' });
    fakePrisma.user.findUnique.mockResolvedValueOnce(null);
    const res = await POST(req('acme'), ctx('acme'));
    expect(res.status).toBe(404);
    expect(fakeEnsureCustomer).not.toHaveBeenCalled();
  });
});
