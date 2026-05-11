'use client';

import { useActionState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS } from '@envstore/shared';

import { updateGroupAction, type GroupSettingsState } from './actions';

const initial: GroupSettingsState = { ok: false, error: null };

export function GroupSettingsForm({
  workspaceSlug,
  groupSlug,
  defaultName,
  defaultDescription,
}: {
  workspaceSlug: string;
  groupSlug: string;
  defaultName: string;
  defaultDescription: string;
}) {
  const boundAction = updateGroupAction.bind(null, workspaceSlug, groupSlug);
  const [state, action, pending] = useActionState(boundAction, initial);

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          maxLength={LIMITS.nameMax}
          defaultValue={defaultName}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          maxLength={LIMITS.descriptionMax}
          defaultValue={defaultDescription}
        />
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
