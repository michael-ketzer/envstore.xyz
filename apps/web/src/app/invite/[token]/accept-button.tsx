'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { acceptInviteAction, type AcceptInviteState } from './actions';

const initial: AcceptInviteState = { error: null };

export function AcceptButton({ token }: { token: string }) {
  const boundAction = acceptInviteAction.bind(null, token);
  const [state, action, pending] = useActionState(boundAction, initial);
  return (
    <form action={action} className="space-y-3">
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Accepting…' : 'Accept invite'}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
