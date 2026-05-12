// Tests for the email-OTP request/verify flow. The F6 fix moved the hash
// from sha256(email:code) to HMAC-SHA256(AUTH_SECRET, email:code) with a
// timing-safe compare; these tests pin both the HMAC pepper (a DB dump
// alone shouldn't brute-force the 1M-code space) and the verify state
// machine (attempts, expiry, single-use).
//
// We mock @envstore/db, @/env, and the side-effect modules (email,
// rate-limit) so the tests run without a database or a real mailer.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import { makeDbMock } from '@/test/db-mock';
import { makeEmailMock } from '@/test/email-mock';
import { makeEnvMock as makeEnvMockHelper } from '@/test/env-mock';

const TEST_SECRET = 'test-secret-at-least-thirty-two-characters-long-please';
const TEST_EMAIL = 'alice@example.com';
const TEST_CODE = '123456';
const TEST_USER_ID = 'u_alice';

// HMAC the same way the SUT does so we can stage `verificationToken` rows
// with the hash the verify path expects.
function hmac(email: string, code: string): string {
  return createHmac('sha256', TEST_SECRET).update(`${email}:${code}`).digest('hex');
}

const fakePrisma = {
  verificationToken: {
    findFirst: mock(),
    findMany: mock(),
    create: mock(),
    update: mock(),
    delete: mock(),
    deleteMany: mock(),
  },
  user: {
    upsert: mock(),
  },
};

const fakeRateLimitByIp = mock();
const fakeSendOtpEmail = mock();

// `server-only` is a Next.js compile-time guard; it has no runtime contents
// to test against, so we stub it out for the test runner.
mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
// Use the full-surface env mock so cross-test-file caching can't strip
// `features` from the shape downstream tests rely on.
mock.module('@/env', () => makeEnvMockHelper({ env: { AUTH_SECRET: TEST_SECRET } }));
mock.module('@/lib/email', () => makeEmailMock({ sendOtpEmail: fakeSendOtpEmail }));
mock.module('@/lib/rate-limit', () => ({ rateLimitByIp: fakeRateLimitByIp }));

// Now import the SUT — module mocks above intercept its deps.
const { verifyOtp, requestOtp } = await import('./auth-otp');

beforeEach(() => {
  fakePrisma.verificationToken.findFirst.mockReset();
  fakePrisma.verificationToken.create.mockReset();
  fakePrisma.verificationToken.update.mockReset();
  fakePrisma.verificationToken.delete.mockReset();
  fakePrisma.verificationToken.deleteMany.mockReset();
  fakePrisma.user.upsert.mockReset();
  fakeRateLimitByIp.mockReset();
  fakeSendOtpEmail.mockReset();
});

afterEach(() => {
  mock.restore();
});

describe('verifyOtp — HMAC pepper + state machine', () => {
  test('accepts the correct code and returns the userId', async () => {
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce({
      identifier: TEST_EMAIL,
      token: hmac(TEST_EMAIL, TEST_CODE),
      type: 'email-otp',
      attempts: 0,
      expires: new Date(Date.now() + 5 * 60_000),
    });
    fakePrisma.verificationToken.delete.mockResolvedValueOnce({});
    fakePrisma.user.upsert.mockResolvedValueOnce({ id: TEST_USER_ID });

    const userId = await verifyOtp(TEST_EMAIL, TEST_CODE);
    expect(userId).toBe(TEST_USER_ID);
    // Single-use: the record must be burned on success.
    expect(fakePrisma.verificationToken.delete).toHaveBeenCalledTimes(1);
  });

  test('rejects a code that does not match the HMAC and increments attempts', async () => {
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce({
      identifier: TEST_EMAIL,
      token: hmac(TEST_EMAIL, TEST_CODE),
      type: 'email-otp',
      attempts: 0,
      expires: new Date(Date.now() + 5 * 60_000),
    });
    fakePrisma.verificationToken.update.mockResolvedValueOnce({});

    const userId = await verifyOtp(TEST_EMAIL, '000000');
    expect(userId).toBeNull();
    // No record burn (still alive for the user to retry, up to the cap).
    expect(fakePrisma.verificationToken.delete).not.toHaveBeenCalled();
    // Attempts incremented.
    expect(fakePrisma.verificationToken.update).toHaveBeenCalledTimes(1);
    const updateCall = fakePrisma.verificationToken.update.mock.calls[0]![0];
    expect(updateCall.data.attempts).toEqual({ increment: 1 });
  });

  test('a code valid under a DIFFERENT AUTH_SECRET (plain SHA-256 or wrong pepper) is rejected', async () => {
    // This is the regression check for F6. Before the HMAC switch, the
    // stored hash was sha256(email:code) — anyone with the DB dump could
    // brute-force the code by hashing the 1M candidates. After F6, the
    // pepper is AUTH_SECRET. Staging a row hashed with the WRONG secret
    // and presenting the (otherwise correct) code must fail.
    const wrongSecretHash = createHmac('sha256', 'a-different-secret')
      .update(`${TEST_EMAIL}:${TEST_CODE}`)
      .digest('hex');
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce({
      identifier: TEST_EMAIL,
      token: wrongSecretHash,
      type: 'email-otp',
      attempts: 0,
      expires: new Date(Date.now() + 5 * 60_000),
    });
    fakePrisma.verificationToken.update.mockResolvedValueOnce({});

    const userId = await verifyOtp(TEST_EMAIL, TEST_CODE);
    expect(userId).toBeNull();
    expect(fakePrisma.verificationToken.update).toHaveBeenCalledTimes(1);
  });

  test('returns null when no record exists for the email', async () => {
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce(null);
    const userId = await verifyOtp('nobody@example.com', TEST_CODE);
    expect(userId).toBeNull();
  });

  test('burns expired records without consuming an attempt', async () => {
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce({
      identifier: TEST_EMAIL,
      token: hmac(TEST_EMAIL, TEST_CODE),
      type: 'email-otp',
      attempts: 0,
      expires: new Date(Date.now() - 60_000),
    });
    fakePrisma.verificationToken.delete.mockResolvedValueOnce({});

    const userId = await verifyOtp(TEST_EMAIL, TEST_CODE);
    expect(userId).toBeNull();
    // Expired record is deleted (cleanup); attempts NOT incremented (the
    // user didn't get a chance to guess).
    expect(fakePrisma.verificationToken.delete).toHaveBeenCalledTimes(1);
    expect(fakePrisma.verificationToken.update).not.toHaveBeenCalled();
  });

  test('burns records past the max-attempts cap', async () => {
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce({
      identifier: TEST_EMAIL,
      token: hmac(TEST_EMAIL, TEST_CODE),
      type: 'email-otp',
      attempts: 5, // ≥ DEFAULTS.otpMaxAttempts (5)
      expires: new Date(Date.now() + 5 * 60_000),
    });
    fakePrisma.verificationToken.delete.mockResolvedValueOnce({});

    const userId = await verifyOtp(TEST_EMAIL, TEST_CODE);
    expect(userId).toBeNull();
    expect(fakePrisma.verificationToken.delete).toHaveBeenCalledTimes(1);
  });

  test('email is normalized (case + whitespace) on both store and compare', async () => {
    // The user types " Alice@Example.com " in the browser; the request and
    // verify paths must both fold it to the same canonical form so the
    // HMAC comparison succeeds across the round trip.
    const canonicalEmail = 'alice@example.com';
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce({
      identifier: canonicalEmail,
      token: hmac(canonicalEmail, TEST_CODE),
      type: 'email-otp',
      attempts: 0,
      expires: new Date(Date.now() + 5 * 60_000),
    });
    fakePrisma.verificationToken.delete.mockResolvedValueOnce({});
    fakePrisma.user.upsert.mockResolvedValueOnce({ id: TEST_USER_ID });

    const userId = await verifyOtp('  Alice@Example.com  ', TEST_CODE);
    expect(userId).toBe(TEST_USER_ID);
    // Confirm the prisma query was scoped to the canonicalized email.
    const findCall = fakePrisma.verificationToken.findFirst.mock.calls[0]![0];
    expect(findCall.where.identifier).toBe(canonicalEmail);
  });
});

describe('requestOtp — peppered hash on creation', () => {
  test('stores the HMAC hash (not the raw code) on the verificationToken row', async () => {
    fakeRateLimitByIp.mockResolvedValueOnce({ success: true });
    fakePrisma.verificationToken.findFirst.mockResolvedValueOnce(null);
    fakePrisma.verificationToken.deleteMany.mockResolvedValueOnce({});
    fakePrisma.verificationToken.create.mockResolvedValueOnce({});
    fakeSendOtpEmail.mockResolvedValueOnce(undefined);

    const result = await requestOtp(TEST_EMAIL);
    expect(result).toEqual({ ok: true });

    // The CREATE call must carry an HMAC-shaped 64-char hex string, NOT the
    // 6-digit code itself.
    expect(fakePrisma.verificationToken.create).toHaveBeenCalledTimes(1);
    const createCall = fakePrisma.verificationToken.create.mock.calls[0]![0];
    expect(createCall.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(createCall.data.token).not.toMatch(/^\d{6}$/);

    // The email path receives the cleartext code (so the user can read it),
    // not the hash.
    expect(fakeSendOtpEmail).toHaveBeenCalledTimes(1);
    const sendCall = fakeSendOtpEmail.mock.calls[0]!;
    expect(sendCall[0]).toBe(TEST_EMAIL);
    expect(sendCall[1]).toMatch(/^\d{6}$/);
  });

  test('honors the IP rate limit and short-circuits without inserting', async () => {
    fakeRateLimitByIp.mockResolvedValueOnce({ success: false });
    const result = await requestOtp(TEST_EMAIL);
    expect(result).toEqual({ ok: false, reason: 'rate-limited' });
    expect(fakePrisma.verificationToken.create).not.toHaveBeenCalled();
    expect(fakeSendOtpEmail).not.toHaveBeenCalled();
  });

  test('rejects malformed email addresses without contacting the DB', async () => {
    const result = await requestOtp('not-an-email');
    expect(result).toEqual({ ok: false, reason: 'invalid-email' });
    expect(fakeRateLimitByIp).not.toHaveBeenCalled();
    expect(fakePrisma.verificationToken.create).not.toHaveBeenCalled();
  });
});
