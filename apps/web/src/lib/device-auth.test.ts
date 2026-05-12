// Tests for the OAuth 2.0 device-authorization helpers. The F7 fix made the
// APPROVED→CONSUMED transition atomic: two parallel polls can no longer
// both mint a token from the same approval. We pin that with a fake prisma
// where `updateMany` returns count: 0 for the loser of the race.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  deviceAuthorization: {
    findUnique: mock(),
    update: mock(),
    updateMany: mock(),
    create: mock(),
  },
};

const fakeIssueCliToken = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/cli-tokens', () => ({ issueCliToken: fakeIssueCliToken }));

const { pollDeviceAuthorization } = await import('./device-auth');

beforeEach(() => {
  fakePrisma.deviceAuthorization.findUnique.mockReset();
  fakePrisma.deviceAuthorization.update.mockReset();
  fakePrisma.deviceAuthorization.updateMany.mockReset();
  fakeIssueCliToken.mockReset();
});

const TEST_DEVICE_CODE = 'plaintext-device-code';

async function approvedRowFor(deviceCode: string) {
  return {
    id: 'auth_1',
    deviceCodeHash: await sha256Hex(deviceCode),
    userCode: 'ABCD1234',
    clientName: 'envstore-cli',
    ipAddress: null,
    status: 'APPROVED' as const,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    pollIntervalSec: 5,
    lastPolledAt: null,
    pollAttempts: 0,
    approvedByUserId: 'u_user',
    approvedAt: new Date(),
    cliTokenId: null,
    createdAt: new Date(),
    approvedBy: { id: 'u_user', email: 'alice@example.com' },
  };
}

describe('pollDeviceAuthorization — F7 atomic-claim race', () => {
  test('the poll that wins the APPROVED→CONSUMED race mints the token', async () => {
    fakePrisma.deviceAuthorization.findUnique.mockResolvedValueOnce(
      await approvedRowFor(TEST_DEVICE_CODE),
    );
    // Throttle pre-update (lastPolledAt was null) is a no-op write — we
    // still need to swallow it.
    fakePrisma.deviceAuthorization.update.mockResolvedValueOnce({}); // poll-counter update
    // Winner: updateMany matches 1 row (APPROVED → CONSUMED).
    fakePrisma.deviceAuthorization.updateMany.mockResolvedValueOnce({ count: 1 });
    fakeIssueCliToken.mockResolvedValueOnce({ token: 'eswtok_minted', cliTokenId: 'clitok_1' });
    // Final write: stamp cliTokenId on the device row for audit.
    fakePrisma.deviceAuthorization.update.mockResolvedValueOnce({});

    const outcome = await pollDeviceAuthorization(TEST_DEVICE_CODE);
    expect(outcome).toEqual({ kind: 'approved', token: 'eswtok_minted' });

    // Atomic claim happened with the exact narrowing where-clause — narrows
    // by status='APPROVED' so a row already CONSUMED by another poll won't
    // re-mint.
    const claimCall = fakePrisma.deviceAuthorization.updateMany.mock.calls[0]![0];
    expect(claimCall.where).toEqual({ id: 'auth_1', status: 'APPROVED' });
    expect(claimCall.data).toEqual({ status: 'CONSUMED' });

    // Token was minted exactly once.
    expect(fakeIssueCliToken).toHaveBeenCalledTimes(1);
  });

  test('the loser of the race gets `expired` and does NOT mint a token', async () => {
    fakePrisma.deviceAuthorization.findUnique.mockResolvedValueOnce(
      await approvedRowFor(TEST_DEVICE_CODE),
    );
    fakePrisma.deviceAuthorization.update.mockResolvedValueOnce({}); // poll counter
    // Loser: updateMany matches 0 rows (the other poll already CONSUMED it).
    fakePrisma.deviceAuthorization.updateMany.mockResolvedValueOnce({ count: 0 });

    const outcome = await pollDeviceAuthorization(TEST_DEVICE_CODE);
    expect(outcome).toEqual({ kind: 'expired' });
    // The loser MUST NOT issue a second token.
    expect(fakeIssueCliToken).not.toHaveBeenCalled();
  });

  test('CONSUMED rows (seen between approval and the next poll) return expired without retrying the claim', async () => {
    // The status branch reads `auth.status === 'CONSUMED'` directly and
    // returns 'expired' without touching updateMany. Confirms the same
    // outcome on the lookup path too.
    fakePrisma.deviceAuthorization.findUnique.mockResolvedValueOnce({
      ...(await approvedRowFor(TEST_DEVICE_CODE)),
      status: 'CONSUMED' as const,
    });
    fakePrisma.deviceAuthorization.update.mockResolvedValueOnce({});

    const outcome = await pollDeviceAuthorization(TEST_DEVICE_CODE);
    expect(outcome).toEqual({ kind: 'expired' });
    expect(fakePrisma.deviceAuthorization.updateMany).not.toHaveBeenCalled();
    expect(fakeIssueCliToken).not.toHaveBeenCalled();
  });

  test('PENDING rows stay pending — no minting, no consumed', async () => {
    fakePrisma.deviceAuthorization.findUnique.mockResolvedValueOnce({
      ...(await approvedRowFor(TEST_DEVICE_CODE)),
      status: 'PENDING' as const,
      approvedByUserId: null,
    });
    fakePrisma.deviceAuthorization.update.mockResolvedValueOnce({});

    const outcome = await pollDeviceAuthorization(TEST_DEVICE_CODE);
    expect(outcome).toEqual({ kind: 'pending' });
    expect(fakePrisma.deviceAuthorization.updateMany).not.toHaveBeenCalled();
    expect(fakeIssueCliToken).not.toHaveBeenCalled();
  });

  test('expired rows sweep themselves to EXPIRED', async () => {
    fakePrisma.deviceAuthorization.findUnique.mockResolvedValueOnce({
      ...(await approvedRowFor(TEST_DEVICE_CODE)),
      expiresAt: new Date(Date.now() - 60_000),
      status: 'APPROVED' as const,
    });
    fakePrisma.deviceAuthorization.update.mockResolvedValueOnce({});

    const outcome = await pollDeviceAuthorization(TEST_DEVICE_CODE);
    expect(outcome).toEqual({ kind: 'expired' });
    // The poll path observed past-expiry and persisted EXPIRED.
    const updateCall = fakePrisma.deviceAuthorization.update.mock.calls[0]![0];
    expect(updateCall.data).toEqual({ status: 'EXPIRED' });
    expect(fakeIssueCliToken).not.toHaveBeenCalled();
  });
});
