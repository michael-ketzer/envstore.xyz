// Tests for the workspace access tier helper.
//
// This is the F2 gate the push/pull routes consult — getting the
// state→tier mapping wrong silently locks paying users out or grants
// access to lapsed ones. Every branch of `getWorkspaceAccess` needs
// explicit coverage.

import { describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const {
  getWorkspaceAccess,
  requireWorkspaceRead,
  requireWorkspaceWrite,
  WorkspaceAccessDeniedError,
} = await import('./billing');

type Sub = {
  status: string;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  paddleSubscriptionId: string | null;
};

const ws = (subscription: Sub | null) => ({ type: 'TEAM' as const, subscription });

describe('getWorkspaceAccess', () => {
  test('no subscription row → locked / unconfigured', () => {
    const r = getWorkspaceAccess(ws(null));
    expect(r.tier).toBe('locked');
    expect(r.reason).toBe('unconfigured');
  });

  test('ACTIVE → full', () => {
    const r = getWorkspaceAccess(
      ws({ status: 'ACTIVE', trialEndsAt: null, canceledAt: null, paddleSubscriptionId: 'sub_1' }),
    );
    expect(r.tier).toBe('full');
    expect(r.reason).toBe('active');
  });

  test('PAST_DUE → full (Paddle dunning runs in the background)', () => {
    const r = getWorkspaceAccess(
      ws({ status: 'PAST_DUE', trialEndsAt: null, canceledAt: null, paddleSubscriptionId: 'sub_1' }),
    );
    expect(r.tier).toBe('full');
    expect(r.message).toMatch(/payment failed/i);
  });

  test('TRIALING with future trialEndsAt → full', () => {
    const r = getWorkspaceAccess(
      ws({
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + 60_000),
        canceledAt: null,
        paddleSubscriptionId: null,
      }),
    );
    expect(r.tier).toBe('full');
    expect(r.reason).toBe('trialing');
  });

  test('TRIALING with past trialEndsAt → read-only (pulls work, writes blocked)', () => {
    const r = getWorkspaceAccess(
      ws({
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() - 60_000),
        canceledAt: null,
        paddleSubscriptionId: null,
      }),
    );
    expect(r.tier).toBe('read-only');
    expect(r.reason).toBe('trial-expired');
  });

  test('PAUSED → read-only', () => {
    const r = getWorkspaceAccess(
      ws({
        status: 'PAUSED',
        trialEndsAt: null,
        canceledAt: null,
        paddleSubscriptionId: 'sub_1',
      }),
    );
    expect(r.tier).toBe('read-only');
    expect(r.reason).toBe('paused');
  });

  test('CANCELED within grace window → read-only with concrete grace-end date', () => {
    const r = getWorkspaceAccess(
      ws({
        status: 'CANCELED',
        canceledAt: new Date(Date.now() - 60_000),
        trialEndsAt: null,
        paddleSubscriptionId: 'sub_1',
      }),
    );
    expect(r.tier).toBe('read-only');
    expect(r.reason).toBe('cancel-grace');
    // The message must surface a deadline so the user can pull data out.
    expect(r.message).toMatch(/until/i);
  });

  test('CANCELED past grace window → locked', () => {
    const r = getWorkspaceAccess(
      ws({
        status: 'CANCELED',
        canceledAt: new Date(Date.now() - 365 * 24 * 3600_000),
        trialEndsAt: null,
        paddleSubscriptionId: 'sub_1',
      }),
    );
    expect(r.tier).toBe('locked');
    expect(r.reason).toBe('cancel-expired');
  });

  test('CANCELED with no canceledAt → locked (fail-closed, cannot compute grace)', () => {
    const r = getWorkspaceAccess(
      ws({
        status: 'CANCELED',
        canceledAt: null,
        trialEndsAt: null,
        paddleSubscriptionId: 'sub_1',
      }),
    );
    expect(r.tier).toBe('locked');
  });
});

describe('requireWorkspaceRead', () => {
  test('full → passes', () => {
    const res = requireWorkspaceRead(
      ws({ status: 'ACTIVE', trialEndsAt: null, canceledAt: null, paddleSubscriptionId: 'sub_1' }),
    );
    expect(res.tier).toBe('full');
  });

  test('read-only → passes (read tier doesn\'t block pulls)', () => {
    const res = requireWorkspaceRead(
      ws({
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() - 60_000),
        canceledAt: null,
        paddleSubscriptionId: null,
      }),
    );
    expect(res.tier).toBe('read-only');
  });

  test('locked → throws WorkspaceAccessDeniedError carrying the access record', () => {
    expect(() => requireWorkspaceRead(ws(null))).toThrow(WorkspaceAccessDeniedError);
    try {
      requireWorkspaceRead(ws(null));
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceAccessDeniedError);
      if (err instanceof WorkspaceAccessDeniedError) {
        expect(err.access.tier).toBe('locked');
      }
    }
  });
});

describe('requireWorkspaceWrite', () => {
  test('full → passes', () => {
    const res = requireWorkspaceWrite(
      ws({ status: 'ACTIVE', trialEndsAt: null, canceledAt: null, paddleSubscriptionId: 'sub_1' }),
    );
    expect(res.tier).toBe('full');
  });

  test('read-only → throws (writes blocked on read-only tier)', () => {
    expect(() =>
      requireWorkspaceWrite(
        ws({
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() - 60_000),
          canceledAt: null,
          paddleSubscriptionId: null,
        }),
      ),
    ).toThrow(WorkspaceAccessDeniedError);
  });

  test('PAUSED → throws (write blocked, even though pulls still work)', () => {
    expect(() =>
      requireWorkspaceWrite(
        ws({
          status: 'PAUSED',
          trialEndsAt: null,
          canceledAt: null,
          paddleSubscriptionId: 'sub_1',
        }),
      ),
    ).toThrow(WorkspaceAccessDeniedError);
  });
});
