'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS, slugify } from '@envstore/shared';

import { createProjectAction, type CreateProjectState } from './actions';

const initial: CreateProjectState = { error: null };

const NEW_GROUP_SENTINEL = '__new__';

export function NewProjectForm({
  workspaceSlug,
  groups,
  defaultGroupSlug,
}: {
  workspaceSlug: string;
  groups: { slug: string; name: string }[];
  defaultGroupSlug: string | null;
}) {
  const boundAction = createProjectAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  // Group picker is a select with three modes: empty = standalone, an existing
  // slug = move into it, or the sentinel = reveal an inline slug input for a
  // brand-new group. Preselect from the ?group=<slug> URL param if it's valid.
  const presetGroupIsKnown =
    defaultGroupSlug !== null && groups.some((g) => g.slug === defaultGroupSlug);
  const [groupChoice, setGroupChoice] = useState<string>(
    presetGroupIsKnown ? (defaultGroupSlug as string) : '',
  );
  const [newGroupSlug, setNewGroupSlug] = useState<string>(
    !presetGroupIsKnown && defaultGroupSlug ? defaultGroupSlug : '',
  );

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (!slugEdited) setSlug(slugify(e.target.value));
  };

  // Resolve the value the form will submit for `group`.
  const submittedGroup =
    groupChoice === NEW_GROUP_SENTINEL ? newGroupSlug.trim() : groupChoice;

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
      <div className="space-y-2">
        <Label htmlFor="group-choice">Group (optional)</Label>
        <select
          id="group-choice"
          value={groupChoice}
          onChange={(e) => setGroupChoice(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">— No group (standalone) —</option>
          {groups.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name} ({g.slug})
            </option>
          ))}
          <option value={NEW_GROUP_SENTINEL}>+ Create new group…</option>
        </select>
        {groupChoice === NEW_GROUP_SENTINEL ? (
          <Input
            name="new-group-slug"
            value={newGroupSlug}
            onChange={(e) => setNewGroupSlug(slugify(e.target.value))}
            placeholder="my-monorepo"
            minLength={LIMITS.slugMin}
            maxLength={LIMITS.slugMax}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          />
        ) : null}
        <input type="hidden" name="group" value={submittedGroup} />
        <p className="text-xs text-muted-foreground">
          Groups let you cluster related projects (e.g. all apps of one monorepo).
        </p>
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
