// Shared `@/lib/device-auth` mock factory. Same cross-test-file caching
// concern as r2-mock.ts / paddle-mock.ts: a narrow mock from one test file
// becomes the visible export shape for the rest of the suite. Every mock
// must present the full export surface.

type MockFn = (...args: unknown[]) => unknown;

export type DeviceAuthMockOverrides = Partial<{
  startDeviceAuthorization: MockFn;
  pollDeviceAuthorization: MockFn;
  approveDeviceAuthorization: MockFn;
  denyDeviceAuthorization: MockFn;
  getDeviceAuthorizationForReview: MockFn;
  normalizeUserCode: (input: string) => string;
}>;

export function makeDeviceAuthMock(
  overrides: DeviceAuthMockOverrides = {},
): Record<string, unknown> {
  const noop = () => undefined;
  return {
    startDeviceAuthorization: overrides.startDeviceAuthorization ?? noop,
    pollDeviceAuthorization: overrides.pollDeviceAuthorization ?? noop,
    approveDeviceAuthorization: overrides.approveDeviceAuthorization ?? noop,
    denyDeviceAuthorization: overrides.denyDeviceAuthorization ?? noop,
    getDeviceAuthorizationForReview: overrides.getDeviceAuthorizationForReview ?? noop,
    normalizeUserCode:
      overrides.normalizeUserCode ?? ((input: string) => input.replace(/[\s-]/g, '').toUpperCase()),
  };
}
