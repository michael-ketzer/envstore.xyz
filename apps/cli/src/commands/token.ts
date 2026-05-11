// `envstore token` — manage workspace-scoped service tokens used by CI/CD.
//
//   envstore token create <name> [--workspace <slug>] [--expires <days>]
//   envstore token list   [--workspace <slug>]
//   envstore token revoke <id> [--workspace <slug>]
//
// `create` generates an age keypair LOCALLY (server never sees the private
// half) and prints the bearer + the age secret key once. The admin copies
// both into the CI provider's secret store as ENVSTORE_TOKEN and
// ENVSTORE_IDENTITY; subsequent `envstore pull` calls on that runner
// authenticate as the workspace and decrypt with the matching private key.

import { generateIdentity } from '@envstore/crypto/age';
import type { WorkspaceTokenSummary } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { UsageError } from '../lib/errors';
import { c, heading, info, muted, success } from '../lib/output';

type CreateResponse = WorkspaceTokenSummary & { token: string };

export async function token(args: Args): Promise<void> {
  const sub = args.positional[0];
  if (!sub) {
    throw new UsageError('Usage: envstore token <create|list|revoke> ...');
  }
  // Drop the subcommand from positional so handlers see their own args.
  const subArgs: Args = {
    positional: args.positional.slice(1),
    flags: args.flags,
    raw: args.raw,
  };
  if (sub === 'create') return create(subArgs);
  if (sub === 'list' || sub === 'ls') return list(subArgs);
  if (sub === 'revoke' || sub === 'delete') return revoke(subArgs);
  throw new UsageError(`Unknown subcommand: ${sub}`, 'Try: create | list | revoke');
}

async function resolveWorkspaceSlug(args: Args): Promise<string> {
  const flag = stringFlag(args.flags['workspace']);
  if (flag) return flag;
  const cfg = await findProjectConfig();
  if (cfg) return cfg.config.workspace;
  throw new UsageError(
    'No workspace specified.',
    'Pass --workspace <slug>, or run from a directory with envstore.json.',
  );
}

async function create(args: Args): Promise<void> {
  const name = args.positional[0];
  if (!name) throw new UsageError('Usage: envstore token create <name> [--workspace <slug>]');
  const workspaceSlug = await resolveWorkspaceSlug(args);
  const expiresInDays = numberFlag(args.flags['expires']);

  // Generate the age keypair LOCALLY. The private half never leaves this
  // process — server only gets the public recipient.
  const { identity, recipient } = await generateIdentity();

  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);
  const created = await client.post<CreateResponse>(
    `/api/v1/workspaces/${workspaceSlug}/tokens`,
    { name, recipient, ...(expiresInDays !== undefined ? { expiresInDays } : {}) },
  );

  // The bearer + private key are printed exactly once. We don't write them
  // anywhere on disk — that's a deliberate choice to push the user toward
  // their CI provider's secret store rather than leaving secrets at $HOME.
  console.log();
  success(`Created token ${c.cyan(created.name)} for workspace ${c.cyan(workspaceSlug)}.`);
  console.log();
  console.log(c.bold('  Save these two values into your CI secret store NOW —'));
  console.log(c.bold('  they will not be shown again:'));
  console.log();
  console.log(`  ${c.gray('ENVSTORE_TOKEN=')}${created.token}`);
  console.log(`  ${c.gray('ENVSTORE_IDENTITY=')}${identity}`);
  console.log();
  muted(
    `Expires: ${created.expiresAt ? new Date(created.expiresAt).toISOString().slice(0, 10) : 'never'} · ` +
      `Scopes: ${created.scopes.join(', ')}`,
  );
  muted(
    `Once configured, the runner can \`envstore pull\` from this workspace — pushes will encrypt to this identity alongside human members.`,
  );
}

async function list(args: Args): Promise<void> {
  const workspaceSlug = await resolveWorkspaceSlug(args);
  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);
  const res = await client.get<{ tokens: WorkspaceTokenSummary[] }>(
    `/api/v1/workspaces/${workspaceSlug}/tokens`,
  );
  if (res.tokens.length === 0) {
    muted(`No service tokens in ${workspaceSlug} yet.`);
    return;
  }
  heading(`${workspaceSlug} / tokens`);
  for (const t of res.tokens) {
    const status = t.revokedAt
      ? c.gray('revoked')
      : t.expiresAt && new Date(t.expiresAt) < new Date()
        ? c.yellow('expired')
        : c.green('active');
    const lastUsed = t.lastUsedAt
      ? new Date(t.lastUsedAt).toISOString().slice(0, 10)
      : c.gray('never');
    const expires = t.expiresAt
      ? new Date(t.expiresAt).toISOString().slice(0, 10)
      : c.gray('—');
    console.log(
      `  ${c.cyan(t.id.padEnd(28))} ${t.name.padEnd(24)} ${status.padEnd(20)} last:${lastUsed} expires:${expires}`,
    );
  }
}

async function revoke(args: Args): Promise<void> {
  const tokenId = args.positional[0];
  if (!tokenId) {
    throw new UsageError('Usage: envstore token revoke <id> [--workspace <slug>]');
  }
  const workspaceSlug = await resolveWorkspaceSlug(args);
  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);
  await client.del(`/api/v1/workspaces/${workspaceSlug}/tokens/${tokenId}`);
  info(`Revoked token ${c.cyan(tokenId)} in ${c.cyan(workspaceSlug)}.`);
}

function stringFlag(v: string | true | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function numberFlag(v: string | true | undefined): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
