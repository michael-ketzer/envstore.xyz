'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS, slugify } from '@envstore/shared';

import { createProjectAction, type CreateProjectState } from './actions';

const initial: CreateProjectState = { error: null };

export function NewProjectForm({ workspaceSlug }: { workspaceSlug: string }) {
  const boundAction = createProjectAction.bind(null, workspaceSlug);
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
          placeholder="API"
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
          placeholder="api"
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
          placeholder="Customer-facing REST API"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create project'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
