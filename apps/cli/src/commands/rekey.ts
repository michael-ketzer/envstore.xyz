// `envstore rekey` — re-encrypt every env to the workspace's CURRENT recipient
// set, then push as a new version.
//
// Why this exists: when a teammate joins, a service token is minted, or
// someone rotates their identity, OLD ciphertext is still only readable by the
// recipients it was originally encrypted to. Rekey walks each env, decrypts
// with the local identity, and re-encrypts to today's recipient set so every
// active key (human or token) can read everything going forward.
//
// Per-env flow:
//   1. GET /pull          → presigned download + recipientsHash of the version.
//   2. GET /recipients    → current workspace recipients + their hash.
//   3. If hashes match    → skip (no-op; common case once steady state).
//   4. Download, verify, decrypt with local identity.
//   5. Re-encrypt to current recipients.
//   6. POST /push + PUT R2 + finalize.
//
// Scope:
//   envstore rekey                     all envs reachable from envstore.json
//   envstore rekey --project <slug>    filter by project (multi-mode only)
//   envstore rekey --env <slug>        filter by environment slug
//   envstore rekey --dry-run           report what WOULD change, don't push

import { decryptToString, encryptForRecipients } from '@envstore/crypto/age';
import {
  recipientsHashHex,
  sha256Hex,
} from '@envstore/crypto/hash';
import {
  isMultiConfig,
  PERSONAL_WORKSPACE_URL_SLUG,
  type EnvstoreConfig,
} from '@envstore/shared';

import { makeClient, type ApiClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
import { loadIdentity } from '../lib/identity';
import { c, info, muted, success } from '../lib/output';

type RecipientsResponse = {
  workspace: { slug: string; type: 'PERSONAL' | 'TEAM' };
  recipients: { recipient: string }[];
};

type PullResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  ciphertextSize: number;
  ciphertextSha256: string;
  recipientsHash: string;
  downloadUrl: string;
};

type PushInitResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
};

type EnvSummary = {
  slug: string;
  currentVersion: { version: number } | null;
};

type Target = { projectSlug: string; envSlug: string };

export async function rekey(args: Args): Promise<void> {
  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` first, or cd into a project directory.',
    });
  }
  const identity = await loadIdentity();
  if (!identity) {
    throw new CliError('No local identity found.', {
      hint: 'Run `envstore identity init` (or `envstore identity import`) first.',
    });
  }

  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const { workspace } = cfg.config;
  const dryRun = Boolean(args.flags['dry-run']);
  const projectFilter = stringFlag(args.flags['project']);
  const envFilter = stringFlag(args.flags['env']);

  // Build the (project, env) work list from envstore.json + the server's
  // per-project environment list. We rekey every env that has a current
  // version — empty envs have nothing to re-encrypt.
  const projects = projectsFromConfig(cfg.config);
  const targets: Target[] = [];
  for (const proj of projects) {
    if (projectFilter && proj !== projectFilter) continue;
    const envs = await client.get<EnvSummary[]>(
      `/api/v1/workspaces/${workspace}/projects/${proj}/environments`,
    );
    for (const env of envs) {
      if (envFilter && env.slug !== envFilter) continue;
      if (!env.currentVersion) continue;
      targets.push({ projectSlug: proj, envSlug: env.slug });
    }
  }
  if (targets.length === 0) {
    muted('Nothing to rekey — no environments with pushed versions match your filters.');
    return;
  }

  // Fetch the recipient set once: rekey decisions all depend on its hash.
  const recipientsRes = await client.get<RecipientsResponse>(
    `/api/v1/workspaces/${workspace}/recipients`,
  );
  const currentRecipients = recipientsRes.recipients.map((r) => r.recipient);
  if (currentRecipients.length === 0) {
    throw new CliError('Workspace has no recipients to encrypt to.', {
      hint: 'Have at least one member run `envstore identity init` before rekeying.',
    });
  }
  const currentHash = await recipientsHashHex(currentRecipients);
  const displayWorkspace =
    recipientsRes.workspace.type === 'PERSONAL' ? PERSONAL_WORKSPACE_URL_SLUG : workspace;

  info(
    `Workspace ${c.cyan(displayWorkspace)}: ${currentRecipients.length} active recipient${currentRecipients.length === 1 ? '' : 's'}.`,
  );
  info(`${targets.length} env${targets.length === 1 ? '' : 's'} to evaluate.`);
  console.log();

  let rekeyed = 0;
  let skipped = 0;
  for (const [i, target] of targets.entries()) {
    const prefix = c.gray(`[${i + 1}/${targets.length}]`);
    const label = `${target.projectSlug}/${target.envSlug}`;
    const pull = await client.get<PullResponse>(
      `/api/v1/workspaces/${workspace}/projects/${target.projectSlug}/pull?env=${encodeURIComponent(target.envSlug)}`,
    );
    if (pull.recipientsHash === currentHash) {
      skipped += 1;
      muted(`${prefix} ${label} → already current (v${pull.version}). Skipping.`);
      continue;
    }
    if (dryRun) {
      rekeyed += 1;
      info(`${prefix} ${label} → would rekey (v${pull.version} ${shortHash(pull.recipientsHash)} → ${shortHash(currentHash)}).`);
      continue;
    }
    await rekeyOne({
      client,
      workspace,
      target,
      pull,
      identity: identity.identity,
      recipients: currentRecipients,
      prefix,
      label,
    });
    rekeyed += 1;
  }

  console.log();
  if (dryRun) {
    success(`Dry run: ${rekeyed} env${rekeyed === 1 ? '' : 's'} would be rekeyed, ${skipped} already current.`);
  } else {
    success(`Rekeyed ${rekeyed} env${rekeyed === 1 ? '' : 's'}, ${skipped} already current.`);
  }
}

async function rekeyOne(args: {
  client: ApiClient;
  workspace: string;
  target: Target;
  pull: PullResponse;
  identity: string;
  recipients: string[];
  prefix: string;
  label: string;
}): Promise<void> {
  const { client, workspace, target, pull, identity, recipients, prefix, label } = args;

  // 1. Download + verify the current ciphertext.
  const res = await fetch(pull.downloadUrl);
  if (!res.ok) {
    throw new ApiError(
      `R2 download failed for ${label}: HTTP ${res.status}`,
      res.status,
    );
  }
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  if (ciphertext.byteLength !== pull.ciphertextSize) {
    throw new CliError(
      `${label}: downloaded ${ciphertext.byteLength} bytes, expected ${pull.ciphertextSize}.`,
    );
  }
  const downloadedHash = await sha256Hex(ciphertext);
  if (downloadedHash !== pull.ciphertextSha256) {
    throw new CliError(
      `${label}: ciphertext sha256 mismatch — server says ${pull.ciphertextSha256}, got ${downloadedHash}.`,
    );
  }

  // 2. Decrypt locally and re-encrypt to the current recipient set.
  let plaintext: string;
  try {
    plaintext = await decryptToString(ciphertext, identity);
  } catch (err) {
    throw new CliError(
      `${label}: local identity can't decrypt v${pull.version}. ${(err as Error).message}`,
      {
        hint: 'A teammate who can already decrypt this env needs to run `envstore rekey` — your key wasn\'t in the old recipient set.',
      },
    );
  }
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const reEncrypted = await encryptForRecipients(plaintextBytes, recipients);
  const newCiphertextSha256 = await sha256Hex(reEncrypted);
  const newRecipientsHash = await recipientsHashHex(recipients);

  // 3. Push as a new version with a rekey comment so the audit log makes sense.
  const init = await client.post<PushInitResponse>(
    `/api/v1/workspaces/${workspace}/projects/${target.projectSlug}/push`,
    {
      env: target.envSlug,
      ciphertextSize: reEncrypted.byteLength,
      ciphertextSha256: newCiphertextSha256,
      recipientsHash: newRecipientsHash,
      comment: `rekeyed from v${pull.version}`,
    },
  );
  const putRes = await fetch(init.uploadUrl, {
    method: 'PUT',
    body: reEncrypted,
    headers: init.requiredHeaders,
  });
  if (!putRes.ok) {
    throw new ApiError(
      `R2 upload failed for ${label}: HTTP ${putRes.status}`,
      putRes.status,
    );
  }
  await client.post(
    `/api/v1/workspaces/${workspace}/projects/${target.projectSlug}/push/${init.versionId}/finalize`,
    {},
  );
  success(`${prefix} ${label} → rekeyed (v${pull.version} → v${init.version}).`);
}

function projectsFromConfig(config: EnvstoreConfig): string[] {
  if (isMultiConfig(config)) {
    return Array.from(new Set(config.files.map((f) => f.project)));
  }
  return [config.project];
}

function shortHash(hex: string): string {
  return hex.slice(0, 8);
}

function stringFlag(v: string | true | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
