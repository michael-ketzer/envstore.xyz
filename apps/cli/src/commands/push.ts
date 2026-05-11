// `envstore push [file]` — encrypt + upload one or more local env files.
//
// Behavior depends on the envstore.json shape:
//
//   Flat config (legacy single-project):
//     envstore push                  → push .env (default) to the configured project
//     envstore push .env.production  → push .env.production to the same project
//
//   Multi config (monorepo, `files: [...]` array):
//     envstore push                          → push every file in the config
//     envstore push apps/web                 → filter by path prefix
//     envstore push apps/web/.env.local      → filter by exact file
//     envstore push --project foo            → filter by project slug
//     envstore push --env production         → filter by environment
//     (filters AND together)
//
// Per-file flow (identical in both modes):
//   1. Read the file (text + size guards).
//   2. Resolve the target environment.
//   3. Fetch workspace recipients, encrypt with age.
//   4. POST /push → presigned PUT URL.
//   5. PUT ciphertext directly to R2.
//   6. POST /push/<versionId>/finalize.

import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { encryptForRecipients } from '@envstore/crypto/age';
import { recipientsHashHex, sha256Hex } from '@envstore/crypto/hash';
import {
  LIMITS,
  PERSONAL_WORKSPACE_URL_SLUG,
  checkPlaintextSize,
  detectEnvironmentFromFilename,
  isMultiConfig,
  isText,
  renderEnvstoreConfig,
  validateSlug,
  type EnvstoreFileEntry,
} from '@envstore/shared';

import { makeClient, type ApiClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl, writeProjectConfig } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
import { matchFiles } from '../lib/files-filter';
import { c, info, muted, success, warn } from '../lib/output';
import { askConfirm, askText, requireTty } from '../lib/prompt';

type Recipient = {
  id: string;
  recipient: string;
  kind: 'AGE_X25519' | 'SSH_ED25519' | 'SSH_RSA';
  label: string;
  userEmail: string;
};

type PushInitResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  workspaceType: 'PERSONAL' | 'TEAM';
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
};

type RecipientsResponse = { recipients: Recipient[] };

export async function push(args: Args): Promise<void> {
  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root first.',
    });
  }

  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const { workspace } = cfg.config;

  // Recipients are workspace-wide, so fetch once and reuse across files.
  const recipientsResponse = await client.get<RecipientsResponse>(
    `/api/v1/workspaces/${workspace}/recipients`,
  );
  if (recipientsResponse.recipients.length === 0) {
    throw new CliError(
      'No recipients registered on the server for this workspace.',
      {
        hint:
          'Run `envstore identity init` (if you have not yet) so the server knows your public recipient. ' +
          'For team workspaces, every member needs to register at least one identity.',
      },
    );
  }
  const recipients = Array.from(
    new Set(recipientsResponse.recipients.map((r) => r.recipient)),
  );

  if (isMultiConfig(cfg.config)) {
    const configDir = dirname(cfg.path);
    const matches = matchFiles(
      cfg.config.files,
      {
        path: typeof args.positional[0] === 'string' ? args.positional[0] : undefined,
        project: stringFlag(args.flags['project']),
        env: stringFlag(args.flags['env']),
      },
      configDir,
    );
    if (matches.length === 0) {
      throw new CliError('No matching files in envstore.json.', {
        hint: `Configured files: ${cfg.config.files.map((f) => f.path).join(', ')}`,
      });
    }

    // ----- Resolve env per file, batching the prompt -----
    // Pre-classify each match: env is already determined from config or from
    // the filename qualifier (".env.production" etc.), OR the user needs to
    // pick. We ask ONCE for the unknown set so a `envstore push` over four
    // bare ".env" files doesn't fire four identical prompts.
    type Plan = { file: EnvstoreFileEntry; envSlug: string | null };
    const plans: Plan[] = matches.map((file) => {
      if (file.environment) return { file, envSlug: file.environment };
      const det = detectEnvironmentFromFilename(file.path);
      if (det.detected) return { file, envSlug: det.slug };
      return { file, envSlug: null };
    });
    const needsPrompt = plans.filter((p) => p.envSlug === null);
    let promptedEnv: string | null = null;
    if (needsPrompt.length > 0) {
      requireTty();
      const label =
        needsPrompt.length === 1
          ? `${c.cyan(needsPrompt[0]!.file.path)} doesn't name an environment.`
          : `${needsPrompt.length} files don't name an environment.`;
      info(label);
      promptedEnv = askText('Push to which environment?', {
        default: 'development',
        required: true,
        validate: (v) => {
          const r = validateSlug(v);
          return r.ok ? null : r.reason;
        },
      });
      for (const p of plans) {
        if (p.envSlug === null) p.envSlug = promptedEnv;
      }
    }

    // ----- Push every match -----
    for (const [i, plan] of plans.entries()) {
      if (plans.length > 1) {
        info(c.gray(`\n[${i + 1}/${plans.length}] ${plan.file.path}`));
      }
      const filePath = resolve(configDir, plan.file.path);
      await pushOneFile({
        client,
        workspace,
        projectSlug: plan.file.project,
        filePath,
        displayPath: plan.file.path,
        envSlug: plan.envSlug!,
        recipients,
        comment: stringFlag(args.flags['comment']),
      });
    }
    if (plans.length > 1) {
      success(`Pushed ${plans.length}/${plans.length} files.`);
    }

    // ----- Persist the answer back to envstore.json -----
    // Once the user said "development" for the unmapped files, write it into
    // the config so the next push goes through without prompting.
    if (promptedEnv && needsPrompt.length > 0) {
      const updatedFiles: EnvstoreFileEntry[] = cfg.config.files.map((f) => {
        const wasUnmapped = needsPrompt.some((p) => p.file.path === f.path);
        return wasUnmapped ? { ...f, environment: promptedEnv! } : f;
      });
      const updatedContent = renderEnvstoreConfig({
        workspace: cfg.config.workspace,
        files: updatedFiles,
        schemaUrl: cfg.config.$schema,
        apiUrl: cfg.config.apiUrl,
      });
      await writeProjectConfig(cfg.path, updatedContent);
      muted(
        `Saved "${promptedEnv}" as the environment for ${needsPrompt.length} file${needsPrompt.length === 1 ? '' : 's'} in envstore.json — next push won't ask.`,
      );
    }
    return;
  }

  // ----- Flat (legacy) path: positional[0] is a file path, single project -----
  const fileArg = args.positional[0] ?? '.env';
  const filePath = isAbsolute(fileArg) ? fileArg : resolve(process.cwd(), fileArg);

  // Resolve env, tracking whether we had to prompt the user (so we can
  // persist the answer back into envstore.json's `defaultEnv` and skip the
  // prompt next time).
  const flagEnv = stringFlag(args.flags['env']);
  const hadDefaultEnv = Boolean(cfg.config.defaultEnv);
  let envSlug: string;
  let wasPrompted = false;
  if (flagEnv) {
    const r = validateSlug(flagEnv);
    if (!r.ok) throw new CliError(`--env ${flagEnv}: ${r.reason}`);
    envSlug = flagEnv;
  } else if (cfg.config.defaultEnv) {
    envSlug = cfg.config.defaultEnv;
  } else {
    const base = basename(filePath);
    // `.env` and `.env.local` are "no qualifier" filenames — even though the
    // detector might match `.local`, we treat them as ambiguous and ask.
    const isBare = base === '.env' || base === '.env.local';
    const det = detectEnvironmentFromFilename(filePath);
    if (!isBare && det.detected) {
      envSlug = det.slug;
    } else {
      requireTty();
      info(`${c.cyan(base)} doesn't name an environment.`);
      envSlug = askText('Push to which environment?', {
        default: 'development',
        required: true,
        validate: (v) => {
          const r = validateSlug(v);
          return r.ok ? null : r.reason;
        },
      });
      wasPrompted = true;
    }
  }

  await pushOneFile({
    client,
    workspace,
    projectSlug: cfg.config.project,
    filePath,
    displayPath: relative(process.cwd(), filePath) || basename(filePath),
    envSlug,
    recipients,
    comment: stringFlag(args.flags['comment']),
  });

  // Persist the chosen env as defaultEnv so future bare-`.env` pushes don't
  // re-prompt. Only fires when we actually prompted (not when --env was used
  // or the filename carried a qualifier).
  if (wasPrompted && !hadDefaultEnv) {
    const updatedContent = renderEnvstoreConfig({
      workspace: cfg.config.workspace,
      project: cfg.config.project,
      defaultEnv: envSlug,
      schemaUrl: cfg.config.$schema,
      apiUrl: cfg.config.apiUrl,
    });
    await writeProjectConfig(cfg.path, updatedContent);
    muted(
      `Saved "${envSlug}" as defaultEnv in envstore.json — next push won't ask.`,
    );
  }
}

async function pushOneFile(args: {
  client: ApiClient;
  workspace: string;
  projectSlug: string;
  filePath: string;
  displayPath: string;
  envSlug: string;
  recipients: string[];
  comment?: string;
}): Promise<void> {
  const { client, workspace, projectSlug, filePath, displayPath, envSlug, recipients, comment } =
    args;

  let plaintext: Uint8Array;
  try {
    plaintext = await readFile(filePath);
  } catch (err) {
    throw new CliError(`Cannot read ${displayPath}: ${(err as Error).message}`);
  }

  const text = isText(plaintext);
  if (!text.ok) {
    throw new CliError(
      `${displayPath} doesn't look like text (${text.reason}). envstore only accepts text files.`,
    );
  }
  const sizeCheck = checkPlaintextSize(plaintext.byteLength);
  if (sizeCheck.level === 'too-large') {
    throw new CliError(
      `${displayPath} is ${plaintext.byteLength} bytes; cap is ${LIMITS.maxPlaintextBytes} bytes.`,
    );
  }
  if (sizeCheck.level === 'soft-warn') {
    requireTty();
    warn(
      `${displayPath} is ${plaintext.byteLength} bytes — unusually large for an env file.`,
    );
    if (!askConfirm('Push anyway?', false)) throw new CliError('Cancelled.');
  }

  info(
    `Encrypting ${c.cyan(displayPath)} to ${recipients.length} recipient${
      recipients.length === 1 ? '' : 's'
    }…`,
  );
  const ciphertext = await encryptForRecipients(plaintext, recipients);
  if (ciphertext.byteLength > LIMITS.maxCiphertextBytes) {
    throw new CliError(
      `Ciphertext is ${ciphertext.byteLength} bytes; server cap is ${LIMITS.maxCiphertextBytes}.`,
    );
  }
  const ciphertextSha256 = await sha256Hex(ciphertext);
  const recipientsHash = await recipientsHashHex(recipients);

  const init = await client.post<PushInitResponse>(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/push`,
    {
      env: envSlug,
      ciphertextSize: ciphertext.byteLength,
      ciphertextSha256,
      recipientsHash,
      comment,
    },
  );

  info(`Uploading v${init.version} (${ciphertext.byteLength} bytes)…`);
  const putRes = await fetch(init.uploadUrl, {
    method: 'PUT',
    body: ciphertext,
    headers: init.requiredHeaders,
  });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    throw new ApiError(
      `R2 upload failed: HTTP ${putRes.status}${errText ? ` — ${errText.slice(0, 120)}` : ''}`,
      putRes.status,
    );
  }

  await client.post(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/push/${init.versionId}/finalize`,
    {},
  );

  const displayWorkspace =
    init.workspaceType === 'PERSONAL' ? PERSONAL_WORKSPACE_URL_SLUG : workspace;
  success(
    `Pushed ${c.cyan(`${displayWorkspace}/${projectSlug}`)} → ${c.cyan(init.environmentSlug)} (v${init.version}).`,
  );
  muted(
    `On another machine: \`envstore pull${init.environmentSlug === 'development' ? '' : ` ${init.environmentSlug}`}\``,
  );
}

// File path is now an ABSOLUTE path; we look at its basename. `preset` is the
// environment configured in envstore.json (multi mode); it wins over filename
// detection but not over an explicit --env flag.
async function resolveTargetEnv(
  filePath: string,
  args: Args,
  preset: string | undefined,
): Promise<string> {
  const flag = stringFlag(args.flags['env']);
  if (flag) {
    const r = validateSlug(flag);
    if (!r.ok) throw new CliError(`--env ${flag}: ${r.reason}`);
    return flag;
  }
  if (preset) return preset;

  const base = basename(filePath);
  if (base === '.env' || base === '.env.local') {
    requireTty();
    info(`${c.cyan(base)} doesn't name an environment.`);
    return askText('Push to which environment?', {
      default: 'development',
      required: true,
      validate: (v) => {
        const r = validateSlug(v);
        return r.ok ? null : r.reason;
      },
    });
  }

  const det = detectEnvironmentFromFilename(filePath);
  if (det.detected) return det.slug;

  requireTty();
  return askText('Push to which environment?', {
    default: 'development',
    required: true,
    validate: (v) => {
      const r = validateSlug(v);
      return r.ok ? null : r.reason;
    },
  });
}

function stringFlag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

