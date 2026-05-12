// Dedicated re-export of `redeemLinkCode` for the route handler.
//
// Why the separate file: Bun's `mock.module` cache is global per test run
// and FIRST-WINS — once a module path is mocked, later registrations for
// that same path are silently ignored. The redeem route's tests need to
// stub `redeemLinkCode` with a per-test fake, but another test in the
// suite (`projects.test.ts`) also mocks `./project-link-codes` to stub
// `pickUniqueLinkCode`. With both targeting the same file, whichever
// test loads first locks the mock cache and the other ends up with the
// wrong stub.
//
// Giving the route its own re-export path means its mock target is
// independent from the one `projects.test.ts` uses. The implementation
// is unchanged — this is just a stable import path that no other test
// touches.

export { redeemLinkCode } from './project-link-codes-impl';
