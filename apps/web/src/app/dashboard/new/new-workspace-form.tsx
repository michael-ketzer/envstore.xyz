'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS, slugify } from '@envstore/shared';

import { createWorkspaceAction, type CreateWorkspaceState } from './actions';

const initial: CreateWorkspaceState = { error: null };

export function NewWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, initial);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  // Auto-derive slug from name until the user manually edits it.
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
          placeholder="Acme"
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
          placeholder="acme"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits, single hyphens. {LIMITS.slugMin}–{LIMITS.slugMax} chars. Used
          in URLs.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create workspace'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
