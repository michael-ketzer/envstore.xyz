import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load env vars from the repo root so a single .env at /envstore.xyz/.env is
// shared by Next.js, Prisma, and any future tooling. Next.js's own .env loading
// still runs after this — local apps/web/.env.local overrides root values.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const rel of ['../../.env', '../../.env.local']) {
  const full = path.resolve(here, rel);
  if (existsSync(full)) loadEnv({ path: full, override: false });
}

// Security headers applied to every response. CSP is intentionally NOT here —
// configuring it correctly with Next.js's inline hydration scripts requires
// nonce plumbing through middleware. Keeping the rest tight in the meantime.
const securityHeaders = [
  // Force HTTPS for two years; opt in to browser preload lists.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // No framing — defeats clickjacking. The dashboard renders no embed surface
  // we'd want framed anyway.
  { key: 'X-Frame-Options', value: 'DENY' },
  // No MIME sniffing — browsers must respect our Content-Type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak full URLs (incl. invite tokens, setup codes) to third parties on
  // cross-origin link clicks.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Lock down powerful APIs we don't use — a future XSS can't request them.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()',
  },
  // No Flash/Silverlight policy file lookups, ever.
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are written in TS; let Next.js transpile them.
  transpilePackages: [
    '@envstore/ui',
    '@envstore/shared',
    '@envstore/crypto',
    '@envstore/db',
  ],
  experimental: {
    // Reasonable starting point — flip to true once we adopt Cache Components.
    // cacheComponents: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  // Default to Turbopack (Next 16) — no extra config needed.
};

export default nextConfig;
