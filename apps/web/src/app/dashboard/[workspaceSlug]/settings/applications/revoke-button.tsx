'use client';

import { useActionState, useState } from 'react';

import { Button } from '@envstore/ui';

import { revokeApplicationAction, type RevokeApplicationState } from './actions';

const initial: RevokeApplicationState = { error: null, revoked: false };

export function RevokeApplicationButton({
  workspaceSlug,
  applicationId,
}: {
  workspaceSlug: string;
  applicationId: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    revokeApplicationAction.bind(null, workspaceSlug, applicationId),
    initial,
  );
  if (state.revoked) return <span className="text-muted-foreground text-xs">Revoked</span>;
  return (
    <form action={action} className="shrink-0 space-y-2">
      {confirming ? (
        <>
          <p className="text-muted-foreground max-w-56 text-xs">
            Stop this application’s access to all its tenant keys?
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>
              {pending ? 'Revoking…' : 'Revoke access'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Revoke
        </Button>
      )}
      {state.error ? (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
