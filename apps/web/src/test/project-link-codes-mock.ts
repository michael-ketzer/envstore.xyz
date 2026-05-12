// Shared `@/lib/project-link-codes` mock factory for the bun:test suite.
//
// Same cross-test-file caching concern as db-mock / env-mock: a test that
// mocks `@/lib/project-link-codes` with only the symbols IT needs poisons
// the cached export shape for everyone else. The next test whose SUT
// imports a different symbol fails with either `<fn> is not a function`
// or `SyntaxError: Export named '<fn>' not found in module …`.
//
// Every mock of `@/lib/project-link-codes` must therefore present the full
// named-export surface. This helper keeps that surface in one place —
// callers pass in only the function(s) they care about, everything else
// gets a benign default with the right SHAPE so other tests' imports
// don't crash.

export type ProjectLinkCodesMockOverrides = Partial<{
  normalizeLinkCode: (input: string) => string;
  formatLinkCode: (code: string) => string;
  pickUniqueLinkCode: () => Promise<string>;
  ensureLinkCode: (projectId: string) => Promise<string>;
  redeemLinkCode: (opts: { code: string; userId: string }) => Promise<unknown>;
}>;

export function makeProjectLinkCodesMock(
  overrides: ProjectLinkCodesMockOverrides = {},
): Record<string, unknown> {
  return {
    normalizeLinkCode:
      overrides.normalizeLinkCode ??
      ((input: string) => input.replace(/[\s-]/g, '').toUpperCase()),
    formatLinkCode:
      overrides.formatLinkCode ??
      ((code: string) => `${code.slice(0, 4)}-${code.slice(4)}`),
    pickUniqueLinkCode: overrides.pickUniqueLinkCode ?? (async () => 'STUBCPDE'),
    ensureLinkCode: overrides.ensureLinkCode ?? (async () => 'STUBCPDE'),
    redeemLinkCode:
      overrides.redeemLinkCode ??
      (async () => ({ ok: false, reason: 'not-found', message: 'stub' })),
  };
}
