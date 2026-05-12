// Shared `@/env` mock factory. Same cross-test-file caching concern as the
// other mock helpers: a test file that mocks `@/env` with only the symbols
// it personally needs poisons the cached export shape for the rest of the
// suite. Any later test whose SUT imports a different env symbol then
// fails at module load (`Export named 'features' not found in ...`).
// Every `@/env` mock must present BOTH `env` AND `features`.

export type EnvMockOverrides = Partial<{
  env: Record<string, unknown>;
  features: Record<string, boolean>;
}>;

const DEFAULT_FEATURES = {
  githubAuth: false,
  googleAuth: false,
  emailOtp: false,
  emailInboundForward: false,
  r2: false,
  paddle: false,
};

export function makeEnvMock(overrides: EnvMockOverrides = {}): Record<string, unknown> {
  // Mutate-into-place so tests that flip flags between cases (e.g.
  // `fakeFeatures.emailInboundForward = false`) keep their existing
  // reference semantics — we hand back the SAME `features` object the
  // caller passed in (filled in with defaults for missing flags), not a
  // fresh copy.
  const features = overrides.features ?? {};
  for (const [k, v] of Object.entries(DEFAULT_FEATURES)) {
    if (!(k in features)) (features as Record<string, boolean>)[k] = v;
  }
  return {
    env: overrides.env ?? {},
    features,
  };
}
