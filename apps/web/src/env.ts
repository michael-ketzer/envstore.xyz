// Server-only env validation. Throws on import if required values are missing.
// Client code MUST import from './env.client' instead.
import 'server-only';
import { z } from 'zod';

// Treat empty / whitespace-only strings as "unset". Otherwise `OPT=""` in
// .env (as our .env.example showed) would fail .min(1)/.email()/.url() rather
// than being absent.
const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

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

  // Email
  RESEND_API_KEY: optionalString,
  // Resend accepts both bare addresses and `Display Name <addr@host>` format,
  // so we validate as a non-empty string and let Resend reject malformed values
  // at send time.
  RESEND_FROM: optionalString,

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
  githubAuth: Boolean(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
  googleAuth: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  emailOtp: Boolean(env.RESEND_API_KEY && env.RESEND_FROM),
  r2: Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  ),
  paddle: Boolean(
    env.PADDLE_API_KEY && env.PADDLE_WEBHOOK_SECRET && env.PADDLE_PRICE_ID_TEAM,
  ),
} as const;
