'use client';

import { useActionState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import {
  LIMITS,
  VERSION_HISTORY_LIMIT_MAX,
  VERSION_HISTORY_LIMIT_MIN,
} from '@envstore/shared';

import { updateWorkspaceAction, type SettingsState } from './actions';

const initial: SettingsState = { ok: false, error: null };

export function WorkspaceSettingsForm({
  workspaceSlug,
  defaultName,
  defaultDescription,
  defaultRetention,
  defaultVersionHistoryLimit,
}: {
  workspaceSlug: string;
  defaultName: string;
  defaultDescription: string;
  defaultRetention: number;
  defaultVersionHistoryLimit: number;
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

      <div className="space-y-2">
        <Label htmlFor="versionHistoryLimit">Version history per environment</Label>
        <Input
          id="versionHistoryLimit"
          name="versionHistoryLimit"
          type="number"
          min={VERSION_HISTORY_LIMIT_MIN}
          max={VERSION_HISTORY_LIMIT_MAX}
          step={1}
          defaultValue={defaultVersionHistoryLimit}
        />
        <p className="text-xs text-muted-foreground">
          How many past versions to keep per environment. Older versions
          (and their encrypted blobs in storage) are pruned on the next
          successful push. The current version is always preserved.
          Range: {VERSION_HISTORY_LIMIT_MIN}–{VERSION_HISTORY_LIMIT_MAX}.
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
