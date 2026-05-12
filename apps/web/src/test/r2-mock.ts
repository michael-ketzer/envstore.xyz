// Shared `@/lib/r2` mock factory. Same rationale as db-mock.ts: bun:test
// caches module mocks across the run, so the FIRST `mock.module('@/lib/r2',
// …)` call's export shape becomes the visible shape for the rest of the
// suite. If different tests mock only the exports they personally need
// (some only presignGet, some only headObject), later tests fail to import
// missing names. Every r2 mock must present the full export surface; this
// helper keeps that surface in one place.

// Avoid importing from `bun:test` so this file typechecks under
// `tsc --noEmit` (which the tsconfig has excluded *.test.ts from but kept
// the test/ helpers in). Callers pass their own `mock()` factories.

export class FakeR2NotConfigured extends Error {
  constructor() {
    super('R2 not configured');
    this.name = 'R2NotConfiguredError';
  }
}

// Loose type for a bun mock — we only need it to be callable; the test
// files own the concrete typing.
type MockFn = (...args: unknown[]) => unknown;

export type R2MockOverrides = Partial<{
  presignGet: MockFn;
  presignPut: MockFn;
  headObject: MockFn;
  deleteObjects: MockFn;
  buildVersionKey: (opts: {
    workspaceId: string;
    projectId: string;
    environmentId: string;
    version: number;
  }) => string;
}>;

export function makeR2Mock(overrides: R2MockOverrides = {}): Record<string, unknown> {
  const noop = () => undefined;
  return {
    presignGet: overrides.presignGet ?? noop,
    presignPut: overrides.presignPut ?? noop,
    headObject: overrides.headObject ?? noop,
    deleteObjects: overrides.deleteObjects ?? noop,
    buildVersionKey:
      overrides.buildVersionKey ??
      ((opts: {
        workspaceId: string;
        projectId: string;
        environmentId: string;
        version: number;
      }) =>
        `workspaces/${opts.workspaceId}/projects/${opts.projectId}/environments/${opts.environmentId}/versions/v${opts.version}`),
    R2NotConfiguredError: FakeR2NotConfigured,
  };
}
