'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { revokeRecipientAction, type RevokeRecipientState } from './actions';

const initial: RevokeRecipientState = { error: null };

export function RevokeRecipientButton({
  recipientId,
  label,
}: {
  recipientId: string;
  label: string;
}) {
  const bound = revokeRecipientAction.bind(null, recipientId);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            `Revoke "${label}"? Pushes will stop encrypting to this recipient. ` +
              `Existing ciphertext stays decryptable by whoever holds the private key — ` +
              `run \`envstore rekey\` afterwards to re-encrypt without it.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
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
