'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { rollbackToVersionAction, type RollbackState } from './actions';

const initial: RollbackState = { ok: false, error: null };

export function RollbackButton({
  workspaceSlug,
  projectSlug,
  envSlug,
  versionId,
  versionNumber,
  isCurrent,
}: {
  workspaceSlug: string;
  projectSlug: string;
  envSlug: string;
  versionId: string;
  versionNumber: number;
  isCurrent: boolean;
}) {
  const bound = rollbackToVersionAction.bind(
    null,
    workspaceSlug,
    projectSlug,
    envSlug,
    versionId,
  );
  const [state, action, pending] = useActionState(bound, initial);

  if (isCurrent) {
    return (
      <span className="rounded-md bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
        current
      </span>
    );
  }

  return (
    <form
      action={action}
      className="flex items-center gap-2"
      // Confirm on form submit so keyboard-Enter and any future
      // JS-triggered submit paths both get prompted, not only a click
      // on the Button. The server action also re-checks auth + ownership,
      // but a misclick here is a real-world hazard.
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Make v${versionNumber} the current version for ${envSlug}? Pulls will return this version going forward.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Rolling back…' : 'Make current'}
      </Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}
