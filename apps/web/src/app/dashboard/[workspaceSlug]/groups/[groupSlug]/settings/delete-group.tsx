'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';

import { deleteGroupAction, type GroupSettingsState } from './actions';

const initial: GroupSettingsState = { ok: false, error: null };

export function DeleteGroup({
  workspaceSlug,
  groupSlug,
  projectCount,
}: {
  workspaceSlug: string;
  groupSlug: string;
  projectCount: number;
}) {
  const boundAction = deleteGroupAction.bind(null, workspaceSlug, groupSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [confirm, setConfirm] = useState('');

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Deleting this group does not delete its {projectCount}{' '}
        {projectCount === 1 ? 'project' : 'projects'} — they become standalone and stay in the
        workspace. You can move them into a different group from each project's settings page.
      </p>
      <div className="space-y-2">
        <Label htmlFor="confirm">
          Type{' '}
          <code className="font-mono font-medium text-foreground">{groupSlug}</code> to confirm
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
          disabled={pending || confirm !== groupSlug}
        >
          {pending ? 'Deleting…' : 'Delete group'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
