'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS } from '@envstore/shared';

import { updateProjectAction, type ProjectSettingsState } from './actions';

const initial: ProjectSettingsState = { ok: false, error: null };
const NEW_GROUP_SENTINEL = '__new__';

export function ProjectSettingsForm({
  workspaceSlug,
  projectSlug,
  defaultName,
  defaultDescription,
  defaultGroupSlug,
  groups,
}: {
  workspaceSlug: string;
  projectSlug: string;
  defaultName: string;
  defaultDescription: string;
  defaultGroupSlug: string | null;
  groups: { slug: string; name: string }[];
}) {
  const boundAction = updateProjectAction.bind(null, workspaceSlug, projectSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [groupChoice, setGroupChoice] = useState<string>(defaultGroupSlug ?? '');
  const [newGroupName, setNewGroupName] = useState<string>('');

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
      <div className="space-y-2">
        <Label htmlFor="group-choice">Group</Label>
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
        <input type="hidden" name="group" value={groupChoice} />
        <p className="text-xs text-muted-foreground">
          Move this project into a group, or pick "No group" to keep it standalone.
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
