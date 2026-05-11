'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';

import { softDeleteProjectAction, type ProjectSettingsState } from './actions';

const initial: ProjectSettingsState = { ok: false, error: null };

export function DeleteProject({
  workspaceSlug,
  projectSlug,
  retentionDays,
}: {
  workspaceSlug: string;
  projectSlug: string;
  retentionDays: number;
}) {
  const boundAction = softDeleteProjectAction.bind(null, workspaceSlug, projectSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [confirm, setConfirm] = useState('');

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Deleting this project soft-deletes all environments and version history. They are
        recoverable for {retentionDays} {retentionDays === 1 ? 'day' : 'days'} (the workspace
        soft-delete window) before permanent removal.
      </p>
      <div className="space-y-2">
        <Label htmlFor="confirm">
          Type{' '}
          <code className="font-mono font-medium text-foreground">{projectSlug}</code> to confirm
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
          disabled={pending || confirm !== projectSlug}
        >
          {pending ? 'Deleting…' : 'Delete project'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
