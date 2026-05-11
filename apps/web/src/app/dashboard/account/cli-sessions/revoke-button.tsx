'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { revokeCliTokenAction, type RevokeState } from './actions';

const initial: RevokeState = { error: null };

export function RevokeButton({ tokenId }: { tokenId: string }) {
  const bound = revokeCliTokenAction.bind(null, tokenId);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-destructive"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
