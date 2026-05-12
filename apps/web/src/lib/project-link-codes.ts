// Setup codes for `envstore link <CODE>`. Thin public re-export.
//
// The actual implementation lives in `./project-link-codes-impl.ts`. The
// split exists so the unit tests for the impl can import a path that no
// other test in the suite mocks. Bun's `mock.module` cache is global per
// test run — when one test file mocks `./project-link-codes` with a
// narrow shape (e.g. `{ redeemLinkCode }` or `{ pickUniqueLinkCode }`),
// every later test that imports the same path gets the cached stub, not
// the real module. The implementation-level tests need the real
// functions, so they reach for `./project-link-codes-impl` directly.
// Production code keeps importing `./project-link-codes` — this file
// re-exports everything below.

export * from './project-link-codes-impl';
