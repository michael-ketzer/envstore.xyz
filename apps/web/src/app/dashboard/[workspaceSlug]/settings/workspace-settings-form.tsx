'use client';

import { useActionState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS } from '@envstore/shared';

import { updateWorkspaceAction, type SettingsState } from './actions';

const initial: SettingsState = { ok: false, error: null };

export function WorkspaceSettingsForm({
  workspaceSlug,
  defaultName,
  defaultDescription,
  defaultRetention,
}: {
  workspaceSlug: string;
  defaultName: string;
  defaultDescription: string;
  defaultRetention: number;
}) {
  const boundAction = updateWorkspaceAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Display name</Label>
        <Input
          id="name"
          name="name"
          maxLength={LIMITS.nameMax}
          defaultValue={defaultName}
          required
          placeholder="My team"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          maxLength={LIMITS.descriptionMax}
          defaultValue={defaultDescription}
          placeholder="What's this workspace for? (optional)"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="softDeleteRetentionDays">Soft-delete window (days)</Label>
        <Input
          id="softDeleteRetentionDays"
          name="softDeleteRetentionDays"
          type="number"
          min={0}
          max={365}
          defaultValue={defaultRetention}
        />
        <p className="text-xs text-muted-foreground">
          When a project or environment is deleted, its data is recoverable for this many days
          before permanent removal. Set to <code className="font-mono">0</code> to delete
          immediately.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : state.ok ? (
          <p className="text-sm text-muted-foreground">Saved.</p>
        ) : null}
      </div>
    </form>
  );
}
