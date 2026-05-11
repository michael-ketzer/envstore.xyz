'use client';

import { useActionState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS } from '@envstore/shared';

import { createGroupAction, type CreateGroupState } from './actions';

const initial: CreateGroupState = { error: null };

export function NewGroupForm({ workspaceSlug }: { workspaceSlug: string }) {
  const boundAction = createGroupAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={LIMITS.nameMax}
          placeholder="Shinra Metrics"
        />
        <p className="text-xs text-muted-foreground">
          A URL slug is generated automatically. You'll only see it in links.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          name="description"
          maxLength={LIMITS.descriptionMax}
          placeholder="Monorepo for the Shinra Metrics platform"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create group'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
