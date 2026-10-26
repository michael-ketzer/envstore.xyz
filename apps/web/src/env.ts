// Server-only env validation. Throws on import if required values are missing.
// Client code MUST import from './env.client' instead.
import 'server-only';
import { z } from 'zod';

// Treat empty / whitespace-only strings as "unset". Otherwise `OPT=""` in
// .env (as our .env.example showed) would fail .min(1)/.email()/.url() rather
// than being absent.
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database (Neon)
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Auth.js
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be >= 32 chars — generate with `openssl rand -base64 32`'),
  AUTH_URL: optionalUrl,

  // OAuth — providers register only when both ID and SECRET are set
  AUTH_GITHUB_ID: optionalString,
  AUTH_GITHUB_SECRET: optionalString,
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,

  // Email — the Resend SDK uses Letterpier's compatible API.
  LETTERPIER_API_KEY: optionalString,
  LETTERPIER_BASE_URL: z.preprocess(
    blankToUndefined,
    z.literal('https://app.letterpier.com').default('https://app.letterpier.com'),
  ),
  // Keep display names and mailbox names on the verified production domain.
  LETTERPIER_FROM: optionalString,
  // Incoming webhooks contain metadata only; the mail helper fetches the
  // body and attachments with a full-access live key before forwarding.
  LETTERPIER_WEBHOOK_SECRET: optionalString,
  LETTERPIER_INBOUND_FORWARD_TO: z.preprocess(blankToUndefined, z.string().email().optional()),

  // R2
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  // Jurisdiction-restricted buckets need a different endpoint host. `default`
  // uses <account>.r2.cloudflarestorage.com; `eu`/`fedramp` use
  // <account>.<jurisdiction>.r2.cloudflarestorage.com. Signing region is
  // always "auto" — passing the jurisdiction as region causes R2 to reject
  // requests with InvalidRegionName.
  // NOTE: location HINTS (WNAM/EEUR/etc.) are NOT jurisdictions. If you
  // created the bucket with `--location-hint` rather than `--jurisdiction`,
  // leave this unset (or `default`).
  R2_JURISDICTION: z
    .preprocess(blankToUndefined, z.enum(['default', 'eu', 'fedramp']).optional())
    .transform((v) => v ?? 'default'),

  // Paddle
  PADDLE_ENV: z
    .preprocess(blankToUndefined, z.enum(['sandbox', 'production']).optional())
    .transform((v) => v ?? 'sandbox'),
  PADDLE_API_KEY: optionalString,
  PADDLE_WEBHOOK_SECRET: optionalString,
  // Paddle price ID for the $1.99/mo Team workspace plan. Must be a `pri_…`
  // identifier from the Paddle dashboard. Unset → checkout endpoint returns
  // 503 with a friendly "billing not configured" message.
  PADDLE_PRICE_ID_TEAM: optionalString,

  // Shared secret protecting the retention-sweep cron route. The route accepts
  // either `Authorization: Bearer <secret>` (manual / external schedulers) or
  // a Vercel Cron request (verified via the `x-vercel-cron` header — Vercel
  // injects this only on cron-originated invocations of cron-declared paths).
  // Unset → cron route returns 503 to avoid a misconfigured deployment
  // running un-authed deletes.
  CRON_SECRET: optionalString,

  // Opt-in managed-key service. Use distinct least-privilege Transit tokens.
  OPENBAO_URL: optionalUrl,
  OPENBAO_RUNTIME_TOKEN: optionalString,
  OPENBAO_ADMIN_TOKEN: optionalString,
  // Upload-only broker for age-encrypted OpenBao snapshots. No R2 credentials
  // need to leave this deployment; the host cannot read or delete other data.
  OPENBAO_BACKUP_TOKEN: optionalString,
  OPENBAO_TRANSIT_MOUNT: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('transit'),
  ),
  // Enable only behind an ingress that OVERWRITES X-Forwarded-Proto and
  // prevents direct access to the app. Otherwise request URLs must be HTTPS.
  MANAGED_KEYS_TRUST_PROXY: z
    .preprocess(blankToUndefined, z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  // The audience Vercel OIDC tokens of managed-key applications must carry.
  // Defaults to the origin of NEXT_PUBLIC_APP_URL (e.g. https://www.envstore.xyz).
  MANAGED_KEYS_AUDIENCE: optionalUrl,
  NEXT_PUBLIC_APP_URL: optionalUrl,

  // Number of trusted proxy hops between the public internet and this
  // process. Rate limiters key on the client IP, which we extract from
  // x-forwarded-for; an untrusted appender to that header would otherwise
  // bypass per-IP limits. With N hops, we take the (N+1)-th entry from
  // the right of x-forwarded-for, ignoring anything to the left of it
  // (those are attacker-controlled).
  //
  // Default 1 = single trusted proxy directly in front of this server
  // (Vercel's edge, a typical nginx, Cloudflare). Set to 2 if you have
  // e.g. Cloudflare in front of Vercel. Operators MUST set this correctly
  // for their topology — getting it wrong fails open.
  TRUSTED_PROXY_HOPS: z
    .preprocess(blankToUndefined, z.coerce.number().int().min(0).max(10).optional())
    .transform((v) => v ?? 1),

  // Alternative: name a single header to trust as the authoritative client
  // IP (Cloudflare's `cf-connecting-ip`, Vercel's `x-real-ip`, etc.). When
  // set, this wins over TRUSTED_PROXY_HOPS parsing of x-forwarded-for.
  RATE_LIMIT_IP_HEADER: optionalString,
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const fieldErrors = parsed.error.flatten().fieldErrors;
  console.error('❌ Invalid server environment variables:', fieldErrors);
  const summary = Object.entries(fieldErrors)
    .map(([key, errs]) => `${key}: ${errs?.join('; ') ?? 'invalid'}`)
    .join('\n  ');
  throw new Error(`Invalid environment variables:\n  ${summary}`);
}

export const env = parsed.data;

// Feature flags derived from which env vars are present.
export const features = {
  managedKeys: Boolean(env.OPENBAO_URL && env.OPENBAO_RUNTIME_TOKEN && env.OPENBAO_ADMIN_TOKEN),
  githubAuth: Boolean(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
  googleAuth: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  emailOtp: Boolean(env.LETTERPIER_API_KEY && env.LETTERPIER_FROM),
  emailInboundForward: Boolean(
    env.LETTERPIER_API_KEY &&
    env.LETTERPIER_FROM &&
    env.LETTERPIER_WEBHOOK_SECRET &&
    env.LETTERPIER_INBOUND_FORWARD_TO,
  ),
  r2: Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  ),
  paddle: Boolean(env.PADDLE_API_KEY && env.PADDLE_WEBHOOK_SECRET && env.PADDLE_PRICE_ID_TEAM),
} as const;
