'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS, slugify } from '@envstore/shared';

import { createGroupAction, type CreateGroupState } from './actions';

const initial: CreateGroupState = { error: null };

export function NewGroupForm({ workspaceSlug }: { workspaceSlug: string }) {
  const boundAction = createGroupAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (!slugEdited) setSlug(slugify(e.target.value));
  };

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
          value={name}
          onChange={onNameChange}
          placeholder="Shinra Metrics"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          required
          minLength={LIMITS.slugMin}
          maxLength={LIMITS.slugMax}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
          placeholder="shinra-metrics"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits, single hyphens. Unique within this workspace.
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
