// Workspace access gating based on billing state.
//
// Three tiers:
// - 'full'      — reads + writes allowed (push, pull, list, mutate)
// - 'read-only' — pulls + lists allowed; writes blocked
// - 'locked'    — everything blocked (subscription long-canceled / trial long-expired)
//
// Personal workspaces are always 'full' — they never have a paid subscription.
// API routes call `requireWorkspaceWrite()` (and similar) to enforce.
import 'server-only';

import type { Subscription, Workspace } from '@envstore/db';
import { PRICING } from '@envstore/shared';

export type WorkspaceAccessTier = 'full' | 'read-only' | 'locked';

export type WorkspaceAccess = {
  tier: WorkspaceAccessTier;
  reason:
    | 'personal'
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'trial-expired'
    | 'paused'
    | 'cancel-grace'
    | 'cancel-expired'
    | 'unconfigured';
  // Surface a copy-ready message so callers can echo it to the user.
  message: string;
};

type GatedWorkspace = Pick<Workspace, 'type'> & {
  subscription: Pick<
    Subscription,
    'status' | 'trialEndsAt' | 'canceledAt' | 'paddleSubscriptionId'
  > | null;
};

export function getWorkspaceAccess(workspace: GatedWorkspace): WorkspaceAccess {
  if (workspace.type === 'PERSONAL') {
    return {
      tier: 'full',
      reason: 'personal',
      message: 'Personal workspaces are free, forever.',
    };
  }

  const sub = workspace.subscription;
  if (!sub) {
    return {
      tier: 'locked',
      reason: 'unconfigured',
      message: 'Workspace has no subscription record. Contact support.',
    };
  }

  const now = Date.now();

  switch (sub.status) {
    case 'ACTIVE':
      return {
        tier: 'full',
        reason: 'active',
        message: 'Subscription active.',
      };

    case 'PAST_DUE':
      // Paddle dunning runs on its side — we don't lock the workspace out
      // during retry windows. Users see a banner instead.
      return {
        tier: 'full',
        reason: 'past_due',
        message:
          'Payment failed and is being retried. Update your card on file before the retry window ends.',
      };

    case 'TRIALING': {
      const trialEnd = sub.trialEndsAt?.getTime();
      if (trialEnd && trialEnd > now) {
        return {
          tier: 'full',
          reason: 'trialing',
          message: `Trial ends ${sub.trialEndsAt!.toUTCString()}.`,
        };
      }
      return {
        tier: 'read-only',
        reason: 'trial-expired',
        message:
          'Your free trial has ended. Subscribe to push new versions. Pulls remain available.',
      };
    }

    case 'PAUSED':
      return {
        tier: 'read-only',
        reason: 'paused',
        message:
          'Subscription is paused. Pulls remain available; resume to push new versions.',
      };

    case 'CANCELED': {
      const canceledMs = sub.canceledAt?.getTime();
      if (canceledMs == null) {
        return {
          tier: 'locked',
          reason: 'cancel-expired',
          message: 'Subscription canceled. Resubscribe to regain access.',
        };
      }
      const graceEnd =
        canceledMs + PRICING.postCancelReadGraceDays * 24 * 60 * 60 * 1000;
      if (graceEnd > now) {
        return {
          tier: 'read-only',
          reason: 'cancel-grace',
          message: `Subscription canceled. Read-only until ${new Date(graceEnd).toUTCString()} — pull your data out before then.`,
        };
      }
      return {
        tier: 'locked',
        reason: 'cancel-expired',
        message: 'Subscription canceled and grace period elapsed.',
      };
    }
  }
}

// Convenience helpers for API routes — throw a typed error the route handler
// can turn into the right HTTP status.
export class WorkspaceAccessDeniedError extends Error {
  readonly access: WorkspaceAccess;
  constructor(access: WorkspaceAccess) {
    super(access.message);
    this.name = 'WorkspaceAccessDeniedError';
    this.access = access;
  }
}

export function requireWorkspaceWrite(workspace: GatedWorkspace): WorkspaceAccess {
  const access = getWorkspaceAccess(workspace);
  if (access.tier !== 'full') {
    throw new WorkspaceAccessDeniedError(access);
  }
  return access;
}

export function requireWorkspaceRead(workspace: GatedWorkspace): WorkspaceAccess {
  const access = getWorkspaceAccess(workspace);
  if (access.tier === 'locked') {
    throw new WorkspaceAccessDeniedError(access);
  }
  return access;
}
