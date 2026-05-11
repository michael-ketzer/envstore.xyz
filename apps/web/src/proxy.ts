// Next.js 16 — `proxy.ts` is the new name for `middleware.ts`.
// Runs on Node.js runtime. We use it only for redirecting unauthenticated users.
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

const protectedPrefixes = ['/dashboard', '/onboarding', '/settings'];

function requiresAuth(pathname: string): boolean {
  return protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((req) => {
  const path = req.nextUrl.pathname;
  if (requiresAuth(path) && !req.auth) {
    const url = new URL('/login', req.url);
    url.searchParams.set('callbackUrl', path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
