// RFC 8628-style device authorization helpers.
// The CLI does:
//   1. POST /api/cli/device/start                → deviceCode + userCode + URIs
//   2. polls POST /api/cli/device/poll           → pending until APPROVED
//   3. After approval, the server mints a CliToken and returns it once
//
// Hashed device codes are stored on the server. The plain deviceCode is held
// only by the CLI and transmitted over TLS during polls.

import 'server-only';
import { randomBytes, randomInt } from 'node:crypto';

import { prisma, type DeviceAuthorizationStatus } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';
import {
  DEFAULTS,
  DEVICE_CODE_USER_CODE_ALPHABET,
  DEVICE_CODE_USER_CODE_LENGTH,
} from '@envstore/shared';

import { issueCliToken } from './cli-tokens';

function generateDeviceCode(): string {
  // 32 bytes -> base64url ~43 chars. URL-safe, no padding.
  return randomBytes(32).toString('base64url');
}

function generateUserCode(): string {
  let out = '';
  for (let i = 0; i < DEVICE_CODE_USER_CODE_LENGTH; i++) {
    out += DEVICE_CODE_USER_CODE_ALPHABET[randomInt(0, DEVICE_CODE_USER_CODE_ALPHABET.length)];
  }
  return out;
}

// Normalize a user-provided code: uppercase, strip whitespace + hyphens.
// "abcd-efgh" / "ABCD EFGH" → "ABCDEFGH"
export function normalizeUserCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export type StartedAuthorization = {
  deviceCode: string; // plaintext — returned to the CLI exactly once
  userCode: string;
  formattedUserCode: string; // "XXXX-XXXX" for display
  expiresIn: number; // seconds
  interval: number; // poll seconds
};

export async function startDeviceAuthorization(opts: {
  clientName: string;
  ipAddress: string | null;
}): Promise<StartedAuthorization> {
  // Try a few times to dodge userCode collisions (vanishingly unlikely).
  let userCode = '';
  for (let i = 0; i < 5; i++) {
    const candidate = generateUserCode();
    const clash = await prisma.deviceAuthorization.findUnique({
      where: { userCode: candidate },
    });
    if (!clash) {
      userCode = candidate;
      break;
    }
  }
  if (!userCode) throw new Error('Failed to allocate a unique device user code.');

  const deviceCode = generateDeviceCode();
  const deviceCodeHash = await sha256Hex(deviceCode);
  const expiresAt = new Date(Date.now() + DEFAULTS.deviceCodeExpiryMinutes * 60_000);

  await prisma.deviceAuthorization.create({
    data: {
      deviceCodeHash,
      userCode,
      clientName: opts.clientName.slice(0, 80) || 'envstore-cli',
      ipAddress: opts.ipAddress,
      status: 'PENDING',
      expiresAt,
      pollIntervalSec: DEFAULTS.deviceCodePollIntervalSec,
    },
  });

  return {
    deviceCode,
    userCode,
    formattedUserCode: `${userCode.slice(0, 4)}-${userCode.slice(4)}`,
    expiresIn: DEFAULTS.deviceCodeExpiryMinutes * 60,
    interval: DEFAULTS.deviceCodePollIntervalSec,
  };
}

export type PollOutcome =
  | { kind: 'pending' }
  | { kind: 'slow_down'; interval: number }
  | { kind: 'approved'; token: string }
  | { kind: 'denied' }
  | { kind: 'expired' };

export async function pollDeviceAuthorization(deviceCode: string): Promise<PollOutcome> {
  const deviceCodeHash = await sha256Hex(deviceCode);
  const auth = await prisma.deviceAuthorization.findUnique({
    where: { deviceCodeHash },
    include: { approvedBy: { select: { id: true, email: true } } },
  });
  if (!auth) return { kind: 'expired' };

  // Server-side expiry sweep.
  if (auth.expiresAt < new Date() || auth.status === 'EXPIRED') {
    if (auth.status !== 'EXPIRED') {
      await prisma.deviceAuthorization.update({
        where: { id: auth.id },
        data: { status: 'EXPIRED' },
      });
    }
    return { kind: 'expired' };
  }

  // Naive slow_down: if the CLI polls faster than the published interval, bump it.
  const now = new Date();
  if (auth.lastPolledAt) {
    const sinceLast = (now.getTime() - auth.lastPolledAt.getTime()) / 1000;
    if (sinceLast < auth.pollIntervalSec - 1) {
      const newInterval = Math.min(auth.pollIntervalSec * 2, 30);
      await prisma.deviceAuthorization.update({
        where: { id: auth.id },
        data: {
          pollIntervalSec: newInterval,
          pollAttempts: { increment: 1 },
          lastPolledAt: now,
        },
      });
      return { kind: 'slow_down', interval: newInterval };
    }
  }
  await prisma.deviceAuthorization.update({
    where: { id: auth.id },
    data: { pollAttempts: { increment: 1 }, lastPolledAt: now },
  });

  if (auth.status === 'DENIED') return { kind: 'denied' };
  if (auth.status === 'CONSUMED') return { kind: 'expired' };
  if (auth.status === 'PENDING') return { kind: 'pending' };

  if (auth.status === 'APPROVED' && auth.approvedByUserId) {
    // Mint the token now, on first successful poll after approval. We mark the
    // authorization CONSUMED so the same approval can't be re-traded for another
    // token.
    const { token } = await issueCliToken({
      userId: auth.approvedByUserId,
      name: auth.clientName ?? 'envstore-cli',
    });
    await prisma.deviceAuthorization.update({
      where: { id: auth.id },
      data: { status: 'CONSUMED' satisfies DeviceAuthorizationStatus },
    });
    return { kind: 'approved', token };
  }

  return { kind: 'pending' };
}

export async function approveDeviceAuthorization(opts: {
  userCode: string;
  userId: string;
}): Promise<
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'expired' | 'already-approved' | 'denied' }
> {
  const normalized = normalizeUserCode(opts.userCode);
  const auth = await prisma.deviceAuthorization.findUnique({
    where: { userCode: normalized },
  });
  if (!auth) return { ok: false, reason: 'not-found' };
  if (auth.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (auth.status === 'APPROVED' || auth.status === 'CONSUMED') {
    return { ok: false, reason: 'already-approved' };
  }
  if (auth.status === 'DENIED') return { ok: false, reason: 'denied' };

  await prisma.deviceAuthorization.update({
    where: { id: auth.id },
    data: {
      status: 'APPROVED',
      approvedByUserId: opts.userId,
      approvedAt: new Date(),
    },
  });
  return { ok: true };
}

export async function denyDeviceAuthorization(opts: {
  userCode: string;
}): Promise<{ ok: boolean }> {
  const normalized = normalizeUserCode(opts.userCode);
  const auth = await prisma.deviceAuthorization.findUnique({
    where: { userCode: normalized },
  });
  if (!auth) return { ok: false };
  if (auth.status === 'CONSUMED') return { ok: false };
  await prisma.deviceAuthorization.update({
    where: { id: auth.id },
    data: { status: 'DENIED' },
  });
  return { ok: true };
}

export async function getDeviceAuthorizationForReview(userCode: string) {
  const normalized = normalizeUserCode(userCode);
  return prisma.deviceAuthorization.findUnique({
    where: { userCode: normalized },
  });
}
