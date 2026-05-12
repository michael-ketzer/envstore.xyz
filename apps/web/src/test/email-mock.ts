// Shared `@/lib/email` mock factory. Cross-test mocks of this module
// previously bit auth-otp.test.ts vs invites.test.ts — one supplied
// `sendOtpEmail`, the other `sendInviteEmail`, and whichever loaded first
// fixed the cached export shape. Both functions live in the full surface
// so any later test's SUT finds what it imports.

type MockFn = (...args: unknown[]) => unknown;

export type EmailMockOverrides = Partial<{
  sendOtpEmail: MockFn;
  sendInviteEmail: MockFn;
}>;

export function makeEmailMock(
  overrides: EmailMockOverrides = {},
): Record<string, unknown> {
  const noop = async () => undefined;
  return {
    sendOtpEmail: overrides.sendOtpEmail ?? noop,
    sendInviteEmail: overrides.sendInviteEmail ?? noop,
  };
}
