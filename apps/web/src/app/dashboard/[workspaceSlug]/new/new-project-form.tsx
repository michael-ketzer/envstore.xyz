'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS } from '@envstore/shared';

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

  // Group picker is a select with three modes: empty = standalone, an existing
  // slug = move into it, or the sentinel = reveal a "new group name" input.
  // Preselect from the ?group=<slug> URL param if it's a known group.
  const presetGroupIsKnown =
    defaultGroupSlug !== null && groups.some((g) => g.slug === defaultGroupSlug);
  const [groupChoice, setGroupChoice] = useState<string>(
    presetGroupIsKnown ? (defaultGroupSlug as string) : '',
  );
  const [newGroupName, setNewGroupName] = useState<string>('');

  // We submit two fields: `group` is either an existing slug, the sentinel
  // (server will create a new group from `new-group-name`), or empty (no
  // group). This lets the server use its auto-suffix slug logic for new
  // groups instead of slugifying the typed name client-side.
  const submittedGroup = groupChoice;

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
          placeholder="API"
        />
        <p className="text-xs text-muted-foreground">
          A URL slug is generated automatically. You'll only see it in CLI commands and links.
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
              {g.name}
            </option>
          ))}
          <option value={NEW_GROUP_SENTINEL}>+ Create new group…</option>
        </select>
        {groupChoice === NEW_GROUP_SENTINEL ? (
          <Input
            name="new-group-name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="My Monorepo"
            maxLength={LIMITS.nameMax}
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
