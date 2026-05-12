// Next.js 16 — `proxy.ts` is the new name for `middleware.ts`.
//
// Runs on every page request and serves two unrelated purposes:
//
//   1. Auth redirect: send unauthenticated traffic on protected prefixes to
//      /login with a callbackUrl so the post-login redirect lands them back
//      where they were.
//
//   2. Content-Security-Policy with a per-request nonce. Next's hydration
//      scripts pick up the nonce from the `x-nonce` request header (a
//      framework convention) and emit it on every inline script tag,
//      enabling a tight script-src policy that combines a one-shot nonce
//      with `strict-dynamic`. Scripts loaded by the trusted hydration
//      bundle (e.g. @paddle/paddle-js dynamically injecting cdn.paddle.com)
//      inherit trust. The explicit Paddle hosts in script-src are a
//      fallback for older browsers without strict-dynamic support.
//
//      Trade-off taken: `style-src` keeps `'unsafe-inline'`. Tailwind and
//      Next's CSS-in-JS path emit inline style blocks and per-element
//      `style="…"` attributes that aren't realistic to hash. Inline-style
//      XSS is a much weaker threat surface than inline-script XSS, which
//      we DO block.

import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

const protectedPrefixes = ['/dashboard', '/onboarding', '/settings'];

function requiresAuth(pathname: string): boolean {
  return protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// 128-bit base64 nonce. Cryptographically random via Web Crypto so this
// works on both the Edge runtime and Node — the routes we run today are
// Node, but keeping the dependency minimal avoids a future runtime swap
// breaking CSP unexpectedly.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp(nonce: string): string {
  // React's dev build evaluates strings to reconstruct error stack traces
  // and Next's Fast Refresh uses eval too. Production builds never call
  // eval, so we tighten the policy by dropping `'unsafe-eval'` outside
  // dev. The check runs on every request via the middleware closure but
  // NODE_ENV is constant once the server boots, so this is effectively a
  // build-time switch.
  const devEval = process.env.NODE_ENV === 'development' ? ` 'unsafe-eval'` : '';
  return [
    `default-src 'self'`,
    // strict-dynamic with a per-request nonce: only nonce'd inline scripts
    // are trusted; scripts those load dynamically are also trusted. Modern
    // browsers ignore the URL allowlist when strict-dynamic is present —
    // the Paddle hosts are kept for older browsers that fall back.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval} https://cdn.paddle.com https://*.paddle.com`,
    `style-src 'self' 'unsafe-inline'`,
    // OAuth provider avatars (GitHub, Google, etc.) come from a varied set
    // of hostnames. `https:` is the pragmatic envelope; data: covers
    // framework-emitted SVG sprites and tiny built-ins; blob: covers any
    // future client-side blob URLs (e.g. file preview).
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    // The dashboard talks to its own API and to Paddle for billing init.
    `connect-src 'self' https://*.paddle.com https://cdn.paddle.com`,
    // Paddle's hosted checkout renders inside an iframe.
    `frame-src https://*.paddle.com https://*.paddle.cloud`,
    // We do not allow anyone to frame envstore — clickjacking defense.
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

export default auth((req) => {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const path = req.nextUrl.pathname;

  if (requiresAuth(path) && !req.auth) {
    const url = new URL('/login', req.url);
    url.searchParams.set('callbackUrl', path);
    const response = NextResponse.redirect(url);
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('x-nonce', nonce);
    return response;
  }

  // The nonce travels INTO the framework via the request header so Next's
  // own inline hydration scripts pick it up. Same nonce goes OUT on the
  // response's Content-Security-Policy so the browser accepts those
  // scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
