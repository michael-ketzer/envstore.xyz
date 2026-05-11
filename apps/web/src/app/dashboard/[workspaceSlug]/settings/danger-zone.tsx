'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';

import { softDeleteWorkspaceAction, type SettingsState } from './actions';

const initial: SettingsState = { ok: false, error: null };

export function DangerZone({ workspaceSlug }: { workspaceSlug: string }) {
  const boundAction = softDeleteWorkspaceAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [confirm, setConfirm] = useState('');

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Deleting a workspace soft-deletes its projects and environments. They remain recoverable
        for the soft-delete window above. Members lose access immediately.
      </p>
      <div className="space-y-2">
        <Label htmlFor="confirm">
          Type{' '}
          <code className="font-mono font-medium text-foreground">{workspaceSlug}</code> to
          confirm
        </Label>
        <Input
          id="confirm"
          name="confirm"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="destructive"
          disabled={pending || confirm !== workspaceSlug}
        >
          {pending ? 'Deleting…' : 'Delete workspace'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
