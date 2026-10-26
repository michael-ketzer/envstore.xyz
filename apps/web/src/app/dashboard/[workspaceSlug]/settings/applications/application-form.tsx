'use client';

import { useActionState, useState } from 'react';

import { Button, Input, Label } from '@envstore/ui';

import { CodeBlock } from '@/components/code-block';

import { createApplicationAction, type ApplicationActionState } from './actions';

const initial: ApplicationActionState = { error: null };
const identifierPattern = '[a-zA-Z0-9][a-zA-Z0-9_.:\\-]*';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const presets = {
  vetdocs: {
    name: 'vetdocs-production',
    environment: 'production',
    purpose: 'vetdocs-umk-v1',
    keyName: 'umk',
  },
  custom: { name: '', environment: 'production', purpose: '', keyName: '' },
};

type FormProps = {
  workspaceSlug: string;
  apiWorkspaceSlug: string;
  apiUrl: string;
  audience: string;
};

export function ApplicationForm(props: FormProps) {
  const [generation, setGeneration] = useState(0);
  return (
    <RegistrationForm key={generation} {...props} onDone={() => setGeneration((n) => n + 1)} />
  );
}

function RegistrationForm({
  workspaceSlug,
  apiWorkspaceSlug,
  apiUrl,
  audience,
  onDone,
}: FormProps & { onDone: () => void }) {
  const [preset, setPreset] = useState<'vetdocs' | 'custom'>('vetdocs');
  const [scope, setScope] = useState(presets.vetdocs);
  const [authMode, setAuthMode] = useState<'token' | 'vercel'>('token');
  const [state, action, pending] = useActionState(
    createApplicationAction.bind(null, workspaceSlug),
    initial,
  );

  if (state.created) {
    const config = [
      ...(preset === 'vetdocs' ? ['KEY_PROVIDER=envstore'] : []),
      `ENVSTORE_URL=${apiUrl}`,
      `ENVSTORE_WORKSPACE=${apiWorkspaceSlug}`,
      ...(state.created.token ? [`ENVSTORE_TOKEN=${state.created.token}`] : []),
    ].join('\n');
    return (
      <section
        className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5"
        aria-live="polite"
      >
        <div>
          <h2 className="text-base font-semibold">{state.created.name} is registered</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {state.created.token
              ? 'Save this configuration in your backend’s environment secrets. The token is shown only once.'
              : 'Add this configuration to your backend and authenticate with a Vercel OIDC token.'}
          </p>
        </div>
        <CodeBlock code={config} label="Copy backend configuration" className="w-full" />
        {preset === 'vetdocs' ? (
          <p className="text-muted-foreground text-xs">
            Hosted Vetdocs also needs production escrow storage configured before it can provision
            its first user key.
          </p>
        ) : null}
        {state.created.authMode === 'vercel' ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              Enable OIDC federation in the Vercel project’s security settings and send this token
              as the bearer:
            </p>
            <CodeBlock
              code={`import { getVercelOidcToken } from '@vercel/oidc';\n\nconst token = await getVercelOidcToken({\n  audience: ${JSON.stringify(audience)},\n});`}
              label="Copy OIDC example"
              className="w-full"
            />
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Request purpose: <code className="font-mono">{scope.purpose}</code>. Each tenant’s key is
          created automatically on first use.
        </p>
        <Button type="button" variant="outline" onClick={onDone}>
          {state.created.token ? 'I saved the token' : 'Done'}
        </Button>
      </section>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <fieldset disabled={pending} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="application-preset">Integration</Label>
          <select
            id="application-preset"
            className={selectClass}
            value={preset}
            onChange={(event) => {
              const value = event.target.value as keyof typeof presets;
              setPreset(value);
              setScope(presets[value]);
              setAuthMode('token');
            }}
          >
            <option value="vetdocs">Vetdocs</option>
            <option value="custom">Custom application</option>
          </select>
          {preset === 'vetdocs' ? (
            <p className="text-muted-foreground text-xs">
              Uses Vetdocs’ user master key settings. Register a separate application for each
              environment.
            </p>
          ) : null}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {(
            [
              ['name', 'Application name', 'my-app-production'],
              ['environment', 'Environment', 'production'],
              ['purpose', 'Purpose', 'my-app-encryption-v1'],
              ['keyName', 'Key name', 'app-data'],
            ] as const
          ).map(([field, label, placeholder]) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`application-${field}`}>{label}</Label>
              <Input
                id={`application-${field}`}
                name={field}
                value={scope[field]}
                onChange={(event) =>
                  setScope((current) => ({ ...current, [field]: event.target.value }))
                }
                placeholder={placeholder}
                required
                maxLength={128}
                pattern={identifierPattern}
                title="Start with a letter or number; use letters, numbers, periods, underscores, colons or hyphens."
              />
              {field === 'purpose' ? (
                <p className="text-muted-foreground text-xs">
                  Must match the purpose your backend sends with every key request.
                </p>
              ) : null}
              {field === 'keyName' ? (
                <p className="text-muted-foreground text-xs">
                  Applications with the same environment, key name and purpose share tenant keys.
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="application-maxTenants">Tenant limit</Label>
            <Input
              id="application-maxTenants"
              name="maxTenants"
              type="number"
              min={1}
              max={100000}
              step={1}
              defaultValue={1000}
              required
            />
            <p className="text-muted-foreground text-xs">
              {preset === 'vetdocs'
                ? 'For Vetdocs, each user is a tenant.'
                : 'Maximum tenant keys across applications with this environment and key name.'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="application-authMode">Authentication</Label>
            <select
              id="application-authMode"
              name="authMode"
              className={selectClass}
              value={authMode}
              onChange={(event) => setAuthMode(event.target.value as 'token' | 'vercel')}
            >
              <option value="token">Application token</option>
              <option value="vercel">Vercel OIDC</option>
            </select>
            <p className="text-muted-foreground text-xs">
              {preset === 'vetdocs'
                ? 'Vetdocs’ current adapter reads ENVSTORE_TOKEN. Choose Application token for that integration.'
                : 'Use a token for a backend or Worker, or OIDC for a Vercel deployment.'}
            </p>
          </div>
        </div>
        {authMode === 'token' ? (
          <div className="max-w-sm space-y-2">
            <Label htmlFor="application-expiresInDays">Token lifetime (days)</Label>
            <Input
              id="application-expiresInDays"
              name="expiresInDays"
              type="number"
              min={1}
              max={365}
              step={1}
              defaultValue={90}
              required
            />
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="application-vercelTeamId">Vercel team ID</Label>
              <Input
                id="application-vercelTeamId"
                name="vercelTeamId"
                placeholder="team_…"
                maxLength={69}
                pattern="team_[A-Za-z0-9]{1,64}"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="application-vercelProjectId">Vercel project ID</Label>
              <Input
                id="application-vercelProjectId"
                name="vercelProjectId"
                placeholder="prj_…"
                maxLength={68}
                pattern="prj_[A-Za-z0-9]{1,64}"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="application-vercelEnvironment">Vercel deployment environment</Label>
              <Input
                id="application-vercelEnvironment"
                name="vercelEnvironment"
                defaultValue={scope.environment}
                maxLength={128}
                pattern={identifierPattern}
                required
              />
              <p className="text-muted-foreground text-xs">
                Use production, preview, development, or your custom Vercel environment.
              </p>
            </div>
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          The application can generate and unwrap data keys for every tenant in this environment and
          purpose.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? 'Registering…' : 'Register application'}
        </Button>
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
