'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { revokeTokenAction, type TokenActionState } from './actions';

const initial: TokenActionState = { ok: false, error: null };

export function RevokeTokenButton({
  workspaceSlug,
  tokenId,
}: {
  workspaceSlug: string;
  tokenId: string;
}) {
  const boundAction = revokeTokenAction.bind(null, workspaceSlug, tokenId);
  const [state, action, pending] = useActionState(boundAction, initial);
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke'}
      </Button>
      {state.error ? <p className="mt-1 text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
