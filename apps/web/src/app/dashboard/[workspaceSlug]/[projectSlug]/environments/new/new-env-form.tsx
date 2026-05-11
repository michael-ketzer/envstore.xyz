'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label, cn } from '@envstore/ui';
import { LIMITS } from '@envstore/shared';

import { createEnvironmentAction, type CreateEnvState } from './actions';

const initial: CreateEnvState = { error: null };

const PRESETS = ['production', 'staging', 'development', 'preview', 'test'] as const;

export function NewEnvironmentForm({
  workspaceSlug,
  projectSlug,
}: {
  workspaceSlug: string;
  projectSlug: string;
}) {
  const boundAction = createEnvironmentAction.bind(null, workspaceSlug, projectSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');

  const pickPreset = (preset: string) => {
    setSlug(preset);
    if (!name) setName(preset[0]!.toUpperCase() + preset.slice(1));
  };

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-2">
        <Label>Common environments</Label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => pickPreset(p)}
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-xs transition-colors',
                slug === p
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted/50',
              )}
            >
              {p}
            </button>
          ))}
        </div>
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
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="production"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits, single hyphens. The CLI will autodetect this slug from{' '}
          <code className="font-mono">.env.{slug || 'production'}</code> on push.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Display name (optional)</Label>
        <Input
          id="name"
          name="name"
          maxLength={LIMITS.nameMax}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !slug}>
          {pending ? 'Creating…' : 'Create environment'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
