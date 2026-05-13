import 'server-only';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { prisma } from '@envstore/db';
import { DEFAULTS } from '@envstore/shared';

import { env } from '@/env';

import { sendOtpEmail } from './email';
import { rateLimitByIp } from './rate-limit';

const OTP_TYPE = 'email-otp';

// Pad to N digits, allowing leading zeros — we use a uniform 0–999999 range
// to avoid bias against small numbers.
function generateCode(): string {
  return String(randomInt(0, 10 ** DEFAULTS.otpDigits)).padStart(DEFAULTS.otpDigits, '0');
}

// HMAC the OTP against AUTH_SECRET so a passive DB dump alone isn't enough to
// brute-force the 6-digit code space (1M entries vs. plain SHA-256 is cheap;
// HMAC-SHA-256 with a 32+ byte secret the attacker doesn't have raises the
// bar to "compromise the application server too"). Lowercase hex output so
// it round-trips through the existing String column unchanged.
function hashCode(email: string, code: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`${email}:${code}`).digest('hex');
}

// Constant-time string compare so per-character timing differences don't leak
// a partial-match signal across the network (the email + OTP path is rate-
// limited at the request level already, but the hash compare is the inner
// loop and worth hardening).
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export type RequestOtpResult =
  | { ok: true }
  | { ok: false; reason: 'rate-limited' | 'invalid-email' };

export async function requestOtp(email: string): Promise<RequestOtpResult> {
  const normalized = email.toLowerCase().trim();
  if (!normalized.includes('@')) return { ok: false, reason: 'invalid-email' };

  // Per-IP cap on OTP requests: 10/hour. The per-email 30s cap below prevents
  // one user from spamming themselves; this prevents one origin from spamming
  // many email addresses (signup probing, email enumeration, etc.).
  const ipRl = await rateLimitByIp('otp-request', { limit: 10, windowSec: 3600 });
  if (!ipRl.success) return { ok: false, reason: 'rate-limited' };

  // Per-email 30s rate-limit + token replacement runs under a transaction-scoped
  // Postgres advisory lock so parallel requests for the same address can't race
  // the recency check (read recent → both pass → both delete → both create →
  // user gets two emails). hashtext narrows the key string to the 32-bit lock
  // ID space; cross-email collisions are harmless (they'd just queue briefly).
  // The lock auto-releases at COMMIT/ROLLBACK. sendOtpEmail runs outside the
  // transaction so the SMTP roundtrip doesn't hold the lock or a connection
  // pool slot.
  const lockKey = `otp-request:${normalized}`;
  const code = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const recent = await tx.verificationToken.findFirst({
      where: {
        identifier: normalized,
        type: OTP_TYPE,
        expires: { gt: new Date(Date.now() - 30_000 - DEFAULTS.otpExpiryMinutes * 60_000) },
      },
      orderBy: { expires: 'desc' },
    });
    if (
      recent &&
      recent.expires.getTime() - Date.now() >
        DEFAULTS.otpExpiryMinutes * 60_000 - 30_000
    ) {
      return null;
    }
    const fresh = generateCode();
    const tokenHash = hashCode(normalized, fresh);
    const expires = new Date(Date.now() + DEFAULTS.otpExpiryMinutes * 60_000);
    await tx.verificationToken.deleteMany({
      where: { identifier: normalized, type: OTP_TYPE },
    });
    await tx.verificationToken.create({
      data: { identifier: normalized, token: tokenHash, expires, type: OTP_TYPE },
    });
    return fresh;
  });

  if (code === null) return { ok: false, reason: 'rate-limited' };

  await sendOtpEmail(normalized, code);
  return { ok: true };
}

const FAILURE_WINDOW_MS = DEFAULTS.otpFailureWindowHours * 60 * 60 * 1000;

// Returns userId on success, null otherwise.
export async function verifyOtp(email: string, code: string): Promise<string | null> {
  const normalized = email.toLowerCase().trim();
  const now = new Date();

  // Cross-OTP failure budget check (L2). Read first so we can reject early
  // without leaking whether the user typed the right code — an at-cap email
  // gets the same return value whether or not the OTP was correct, so an
  // attacker who's already burned the budget can't keep mining the oracle.
  const budget = await prisma.otpFailureBudget.findUnique({
    where: { identifier: normalized },
  });
  const budgetInWindow =
    budget !== null && now.getTime() - budget.windowStart.getTime() < FAILURE_WINDOW_MS;
  if (budgetInWindow && budget.failureCount >= DEFAULTS.otpMaxFailuresPerWindow) {
    return null;
  }

  const record = await prisma.verificationToken.findFirst({
    where: { identifier: normalized, type: OTP_TYPE },
    orderBy: { expires: 'desc' },
  });
  if (!record) return null;
  if (record.expires < now) {
    await prisma.verificationToken.delete({
      where: { identifier_token: { identifier: record.identifier, token: record.token } },
    });
    return null;
  }
  if (record.attempts >= DEFAULTS.otpMaxAttempts) {
    await prisma.verificationToken.delete({
      where: { identifier_token: { identifier: record.identifier, token: record.token } },
    });
    return null;
  }

  const expected = hashCode(normalized, code);
  if (!constantTimeEqualHex(expected, record.token)) {
    await prisma.verificationToken.update({
      where: { identifier_token: { identifier: record.identifier, token: record.token } },
      data: { attempts: { increment: 1 } },
    });
    // Track the failure against the 24h budget. If we're still in the prior
    // window, just increment; otherwise reset the window with this failure
    // as the first.
    if (budgetInWindow) {
      await prisma.otpFailureBudget.update({
        where: { identifier: normalized },
        data: { failureCount: { increment: 1 } },
      });
    } else {
      await prisma.otpFailureBudget.upsert({
        where: { identifier: normalized },
        create: { identifier: normalized, failureCount: 1, windowStart: now },
        update: { failureCount: 1, windowStart: now },
      });
    }
    return null;
  }

  // Single-use: burn the token.
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: record.identifier, token: record.token } },
  });

  // Success — clear the failure budget so future windows start clean.
  // deleteMany (not delete) tolerates the no-row case without throwing.
  await prisma.otpFailureBudget.deleteMany({ where: { identifier: normalized } });

  // Upsert the user and mark email verified.
  const user = await prisma.user.upsert({
    where: { email: normalized },
    create: { email: normalized, emailVerified: now },
    update: { emailVerified: now },
  });
  return user.id;
}
