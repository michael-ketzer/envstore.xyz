'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';
import { LIMITS, slugify } from '@envstore/shared';

import { renameWorkspaceSlugAction, type SettingsState } from './actions';

const initial: SettingsState = { ok: false, error: null };

export function RenameSlugForm({ currentSlug }: { currentSlug: string }) {
  const boundAction = renameWorkspaceSlugAction.bind(null, currentSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [newSlug, setNewSlug] = useState(currentSlug);
  const [confirm, setConfirm] = useState('');

  const changed = newSlug !== currentSlug && newSlug.length >= LIMITS.slugMin;
  const ready = changed && confirm === currentSlug;

  return (
    <form action={action} className="space-y-4">
      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-4 text-sm">
        <p className="font-medium text-foreground">Changing the slug breaks existing links.</p>
        <p className="mt-1 text-muted-foreground">
          Any <code className="font-mono">envstore.json</code> file pointing at{' '}
          <code className="font-mono">{currentSlug}</code> stops working until updated. Bookmarks
          and existing URLs 404.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">New slug</Label>
        <Input
          id="slug"
          name="slug"
          minLength={LIMITS.slugMin}
          maxLength={LIMITS.slugMax}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          value={newSlug}
          onChange={(e) => setNewSlug(slugify(e.target.value))}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">
          Type <code className="font-mono font-medium text-foreground">{currentSlug}</code> to
          confirm
        </Label>
        <Input
          id="confirm"
          name="confirm"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="destructive" disabled={pending || !ready}>
          {pending ? 'Renaming…' : 'Rename slug'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
