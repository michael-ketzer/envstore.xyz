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

  // Per-IP cap on OTP requests: 10/hour. The existing per-email 30s cap below
  // prevents one user from spamming themselves; this prevents one origin from
  // spamming many email addresses (signup probing, email enumeration, etc.).
  const ipRl = await rateLimitByIp('otp-request', { limit: 10, windowSec: 3600 });
  if (!ipRl.success) return { ok: false, reason: 'rate-limited' };

  // Rate-limit: at most one OTP request per email every 30 seconds.
  const recent = await prisma.verificationToken.findFirst({
    where: {
      identifier: normalized,
      type: OTP_TYPE,
      expires: { gt: new Date(Date.now() - 30_000 - DEFAULTS.otpExpiryMinutes * 60_000) },
    },
    orderBy: { expires: 'desc' },
  });
  if (recent && recent.expires.getTime() - Date.now() > (DEFAULTS.otpExpiryMinutes * 60_000) - 30_000) {
    return { ok: false, reason: 'rate-limited' };
  }

  const code = generateCode();
  const tokenHash = hashCode(normalized, code);
  const expires = new Date(Date.now() + DEFAULTS.otpExpiryMinutes * 60_000);

  // Single outstanding OTP per email — wipe any prior records.
  await prisma.verificationToken.deleteMany({
    where: { identifier: normalized, type: OTP_TYPE },
  });
  await prisma.verificationToken.create({
    data: { identifier: normalized, token: tokenHash, expires, type: OTP_TYPE },
  });

  await sendOtpEmail(normalized, code);
  return { ok: true };
}

// Returns userId on success, null otherwise.
export async function verifyOtp(email: string, code: string): Promise<string | null> {
  const normalized = email.toLowerCase().trim();

  const record = await prisma.verificationToken.findFirst({
    where: { identifier: normalized, type: OTP_TYPE },
    orderBy: { expires: 'desc' },
  });
  if (!record) return null;
  if (record.expires < new Date()) {
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
    return null;
  }

  // Single-use: burn the token.
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: record.identifier, token: record.token } },
  });

  // Upsert the user and mark email verified.
  const user = await prisma.user.upsert({
    where: { email: normalized },
    create: { email: normalized, emailVerified: new Date() },
    update: { emailVerified: new Date() },
  });
  return user.id;
}
