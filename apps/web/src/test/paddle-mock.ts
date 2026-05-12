// Shared `@/lib/paddle` mock factory. Same cross-test-file caching concern
// as db-mock.ts and r2-mock.ts: a narrow mock from an earlier test file
// (e.g. just verifyAndParseWebhook) becomes the visible export shape for
// the rest of the suite, so any later test whose SUT imports a different
// Paddle helper fails at module load. Every paddle mock must present the
// full surface.

// See r2-mock.ts for why this file avoids importing from `bun:test`.

export class FakeBillingNotConfigured extends Error {
  constructor() {
    super('Paddle not configured');
    this.name = 'BillingNotConfiguredError';
  }
}

type MockFn = (...args: unknown[]) => unknown;

export type PaddleMockOverrides = Partial<{
  ensurePaddleCustomer: MockFn;
  createWorkspaceCheckout: MockFn;
  cancelSubscriptionAtPeriodEnd: MockFn;
  createCustomerPortalSession: MockFn;
  verifyAndParseWebhook: MockFn;
  getPaddleClient: MockFn;
}>;

export function makePaddleMock(overrides: PaddleMockOverrides = {}): Record<string, unknown> {
  const noop = () => undefined;
  return {
    ensurePaddleCustomer: overrides.ensurePaddleCustomer ?? noop,
    createWorkspaceCheckout: overrides.createWorkspaceCheckout ?? noop,
    cancelSubscriptionAtPeriodEnd: overrides.cancelSubscriptionAtPeriodEnd ?? noop,
    createCustomerPortalSession: overrides.createCustomerPortalSession ?? noop,
    verifyAndParseWebhook: overrides.verifyAndParseWebhook ?? noop,
    getPaddleClient: overrides.getPaddleClient ?? noop,
    BillingNotConfiguredError: FakeBillingNotConfigured,
  };
}
