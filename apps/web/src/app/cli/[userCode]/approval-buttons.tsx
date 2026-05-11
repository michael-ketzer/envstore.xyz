'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import {
  approveAction,
  denyAction,
  type CliApprovalState,
} from './actions';

const initial: CliApprovalState = { error: null, approved: false };

export function ApprovalButtons({ userCode }: { userCode: string }) {
  const approveBound = approveAction.bind(null, userCode);
  const denyBound = denyAction.bind(null, userCode);
  const [approveState, approveFn, approvePending] = useActionState(approveBound, initial);
  const [denyState, denyFn, denyPending] = useActionState(denyBound, initial);

  if (approveState.approved) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium text-foreground">Approved.</p>
        <p className="mt-1 text-muted-foreground">
          Return to your terminal — the CLI should be signed in within a few seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <form action={approveFn}>
          <Button type="submit" disabled={approvePending || denyPending}>
            {approvePending ? 'Approving…' : 'Approve & sign in'}
          </Button>
        </form>
        <form action={denyFn}>
          <Button type="submit" variant="outline" disabled={approvePending || denyPending}>
            {denyPending ? 'Denying…' : 'Deny'}
          </Button>
        </form>
      </div>
      {approveState.error ? (
        <p className="text-sm text-destructive">{approveState.error}</p>
      ) : null}
      {denyState.error ? <p className="text-sm text-destructive">{denyState.error}</p> : null}
    </div>
  );
}
