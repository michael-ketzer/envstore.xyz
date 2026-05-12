// Shared `@envstore/db` mock factory for the bun:test suite.
//
// Module mocks in bun:test persist across test files in the same run. If
// one test file mocks @envstore/db with a narrow shape (e.g. just
// `{ prisma }`) and another test file's SUT later imports something else
// from @envstore/db (`Prisma`, `SubscriptionStatus`, …), the second test
// fails because the cached mock doesn't expose those names. Every mock
// must therefore present the full named-export surface area. This helper
// keeps that surface in one place — call it from every test that needs
// to swap @envstore/db.

export class FakePrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super(`prisma error ${code}`);
    this.code = code;
  }
}

const SUBSCRIPTION_STATUS = {
  ACTIVE: 'ACTIVE',
  TRIALING: 'TRIALING',
  PAST_DUE: 'PAST_DUE',
  PAUSED: 'PAUSED',
  CANCELED: 'CANCELED',
} as const;

const DEVICE_AUTHORIZATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
  EXPIRED: 'EXPIRED',
  CONSUMED: 'CONSUMED',
} as const;

export function makeDbMock(opts: { prisma: unknown }): Record<string, unknown> {
  return {
    prisma: opts.prisma,
    // `instanceof Prisma.PrismaClientKnownRequestError` is reference equality
    // on the constructor — the SUT and the test must share the same class.
    Prisma: { PrismaClientKnownRequestError: FakePrismaKnownError },
    SubscriptionStatus: SUBSCRIPTION_STATUS,
    DeviceAuthorizationStatus: DEVICE_AUTHORIZATION_STATUS,
  };
}
