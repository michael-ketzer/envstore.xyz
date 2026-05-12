// Tests for the CSP builder in proxy.ts. The full middleware (auth wrapper +
// header plumbing) is awkward to drive without a NextRequest harness, so we
// pin the policy shape via the pure `buildCsp(nonce)` helper.
//
// proxy.ts transitively imports the auth module (and through it server-only
// + the Prisma client). Stubbing those at the test runtime lets us load the
// file just to grab the pure helper.

import { describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));
mock.module('@/lib/auth', () => ({
  // `auth` wraps a handler — for buildCsp's sake the wrapper is irrelevant.
  auth: (handler: unknown) => handler,
}));

const { buildCsp } = await import('./proxy');

const NONCE = 'aGVsbG8td29ybGQtMTIzNA==';

function getDirective(csp: string, name: string): string | null {
  const part = csp.split(';').map((s) => s.trim()).find((d) => d.startsWith(`${name} `) || d === name);
  return part ?? null;
}

describe('buildCsp', () => {
  test('embeds the nonce on script-src', () => {
    const script = getDirective(buildCsp(NONCE), 'script-src')!;
    expect(script).toContain(`'nonce-${NONCE}'`);
  });

  test("script-src uses 'strict-dynamic' so trusted inline scripts can load Paddle dynamically", () => {
    const script = getDirective(buildCsp(NONCE), 'script-src')!;
    expect(script).toContain(`'strict-dynamic'`);
    // Paddle origins are listed as a fallback for older browsers that
    // don't honor strict-dynamic. Both forms must remain — if either is
    // dropped, billing breaks in production.
    expect(script).toContain('https://cdn.paddle.com');
    expect(script).toContain('https://*.paddle.com');
  });

  test('frame-ancestors is none — clickjacking defense', () => {
    expect(getDirective(buildCsp(NONCE), 'frame-ancestors')).toBe(`frame-ancestors 'none'`);
  });

  test('object-src is none', () => {
    expect(getDirective(buildCsp(NONCE), 'object-src')).toBe(`object-src 'none'`);
  });

  test('form-action is self — no form posts to attacker hosts', () => {
    expect(getDirective(buildCsp(NONCE), 'form-action')).toBe(`form-action 'self'`);
  });

  test('base-uri is self — no <base> hijack', () => {
    expect(getDirective(buildCsp(NONCE), 'base-uri')).toBe(`base-uri 'self'`);
  });

  test('frame-src allows Paddle hosted checkout iframe', () => {
    const frame = getDirective(buildCsp(NONCE), 'frame-src')!;
    expect(frame).toContain('https://*.paddle.com');
    expect(frame).toContain('https://*.paddle.cloud');
  });

  test('upgrade-insecure-requests is present', () => {
    expect(buildCsp(NONCE)).toContain('upgrade-insecure-requests');
  });

  test('nonce is unique per build — same input produces same output, different input produces different', () => {
    expect(buildCsp('AAA')).toBe(buildCsp('AAA'));
    expect(buildCsp('AAA')).not.toBe(buildCsp('BBB'));
  });

  test('directives are semicolon-separated with no trailing newline', () => {
    const csp = buildCsp(NONCE);
    expect(csp).not.toContain('\n');
    expect(csp).not.toMatch(/;\s*$/);
  });
});
