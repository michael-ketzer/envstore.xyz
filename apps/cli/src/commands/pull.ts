// `envstore pull [filter]` — download + decrypt env files.
//
// Behavior depends on the envstore.json shape:
//
//   Flat config (legacy single-project):
//     envstore pull                  → pull the configured project's env (default
//                                       env: configured defaultEnv > "development")
//     envstore pull production       → pull a specific env from that project
//     envstore pull --out path       → override the output filename
//     envstore pull --version 3      → pull a specific historical version
//
//   Multi config (monorepo, `files: [...]` array):
//     envstore pull                          → pull every file in the config
//     envstore pull apps/web                 → filter by path prefix
//     envstore pull apps/web/.env.local      → filter to exactly that entry
//     envstore pull --project shinra-web     → filter by project slug
//     envstore pull --env production         → filter by environment
//     envstore pull --out / --version        → only allowed when filter resolves
//                                              to a single file
//
// Per-file flow:
//   1. Identity check (we never waste an API call without a key locally).
//   2. GET /pull → presigned R2 URL + integrity metadata.
//   3. Download, verify size + sha256.
//   4. Decrypt with local age identity.
//   5. Write to disk (mode 0600), refusing to overwrite without --force.

import { mkdir, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

import { decryptToString } from '@envstore/crypto/age';
import { sha256Hex } from '@envstore/crypto/hash';
import {
  defaultFilenameForEnvironment,
  detectEnvironmentFromFilename,
  isMultiConfig,
  validateSlug,
  type EnvstoreFileEntry,
} from '@envstore/shared';

import { makeClient, type ApiClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
import { matchFiles } from '../lib/files-filter';
import { loadIdentity } from '../lib/identity';
import { c, info, muted, success, warn } from '../lib/output';
import { writeSecretFile } from '../lib/secret-file';

type PullResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  workspaceType: 'PERSONAL' | 'TEAM';
  ciphertextSize: number;
  ciphertextSha256: string;
  recipientsHash: string;
  downloadUrl: string;
  expiresIn: number;
};

const DEFAULT_ENV_SLUG = 'development';

export async function pull(args: Args): Promise<void> {
  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root first.',
    });
  }

  // Identity check first — pointless to make API calls without the key locally.
  const identity = await loadIdentity();
  if (!identity) {
    throw new CliError('No local identity found.', {
      hint: 'Run `envstore identity init` (or `envstore identity import`) first.',
    });
  }

  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const { workspace } = cfg.config;

  if (isMultiConfig(cfg.config)) {
    const configDir = dirname(cfg.path);

    // In multi mode, positional[0] is a path filter — NOT an env name like in
    // flat mode. --env is a filter too.
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

    // --out and --version only make sense when the filter resolves to one file.
    const outOverride = stringFlag(args.flags['out']);
    const versionOverride = stringFlag(args.flags['version']);
    if (matches.length > 1 && outOverride) {
      throw new CliError(
        '--out is only allowed when the filter selects a single file.',
        { hint: 'Drop --out, or narrow the filter (path / --project / --env).' },
      );
    }
    if (matches.length > 1 && versionOverride) {
      throw new CliError(
        '--version is only allowed when the filter selects a single file.',
        {
          hint: 'Drop --version, or narrow the filter (path / --project / --env).',
        },
      );
    }

    for (const [i, file] of matches.entries()) {
      if (matches.length > 1) {
        info(c.gray(`\n[${i + 1}/${matches.length}] ${file.path}`));
      }
      const envSlug = resolveEnvForEntry(file);
      const outPath = outOverride
        ? resolve(process.cwd(), outOverride)
        : resolve(configDir, file.path);
      await pullOneFile({
        client,
        workspace,
        projectSlug: file.project,
        envSlug,
        outPath,
        identity: identity.identity,
        force: Boolean(args.flags['force']),
        versionOverride,
        noGitignoreHint: Boolean(args.flags['no-gitignore-hint']),
      });
    }
    if (matches.length > 1) {
      success(`Pulled ${matches.length}/${matches.length} files.`);
    }
    return;
  }

  // ----- Flat (legacy) path: positional[0] is the env slug -----
  const envFromFlag = stringFlag(args.flags['env']);
  const envSlug =
    args.positional[0] ?? envFromFlag ?? cfg.config.defaultEnv ?? DEFAULT_ENV_SLUG;
  const slugCheck = validateSlug(envSlug);
  if (!slugCheck.ok) {
    throw new CliError(`Invalid environment slug "${envSlug}": ${slugCheck.reason}`);
  }
  const outOverride = stringFlag(args.flags['out']);
  const outPath = resolve(
    process.cwd(),
    outOverride ?? defaultFilenameForEnvironment(envSlug),
  );
  await pullOneFile({
    client,
    workspace,
    projectSlug: cfg.config.project,
    envSlug,
    outPath,
    identity: identity.identity,
    force: Boolean(args.flags['force']),
    versionOverride: stringFlag(args.flags['version']),
    noGitignoreHint: Boolean(args.flags['no-gitignore-hint']),
  });
}

async function pullOneFile(args: {
  client: ApiClient;
  workspace: string;
  projectSlug: string;
  envSlug: string;
  outPath: string;
  identity: string;
  force: boolean;
  versionOverride: string | undefined;
  noGitignoreHint: boolean;
}): Promise<void> {
  const {
    client,
    workspace,
    projectSlug,
    envSlug,
    outPath,
    identity,
    force,
    versionOverride,
    noGitignoreHint,
  } = args;

  const qs = new URLSearchParams({ env: envSlug });
  if (versionOverride) qs.set('version', versionOverride);
  const meta = await client.get<PullResponse>(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/pull?${qs.toString()}`,
  );

  info(`Downloading ${c.cyan(meta.environmentSlug)} v${meta.version}…`);
  const dlRes = await fetch(meta.downloadUrl);
  if (!dlRes.ok) {
    throw new ApiError(`Download failed: HTTP ${dlRes.status}`, dlRes.status);
  }
  const ciphertext = new Uint8Array(await dlRes.arrayBuffer());
  if (ciphertext.byteLength !== meta.ciphertextSize) {
    throw new CliError(
      `Size mismatch: server said ${meta.ciphertextSize}, R2 returned ${ciphertext.byteLength}.`,
    );
  }
  const actualSha = await sha256Hex(ciphertext);
  if (actualSha !== meta.ciphertextSha256) {
    throw new CliError(
      'Ciphertext hash mismatch — the bytes from R2 do not match what the server recorded. Refusing to decrypt.',
    );
  }

  let plaintext;
  try {
    plaintext = await decryptToString(ciphertext, identity);
  } catch (err) {
    throw new CliError(`Decryption failed: ${(err as Error).message}`, {
      hint:
        'Your local identity may not be in this version\'s recipient set. ' +
        'Ask a teammate to re-push after adding your recipient via the dashboard.',
    });
  }

  // Overwrite refusal (unless --force).
  if (!force) {
    try {
      await stat(outPath);
      throw new CliError(`${outPath} already exists.`, {
        hint: 'Pass --force to overwrite, or --out <path> for a different filename.',
      });
    } catch (err) {
      if (err instanceof CliError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  // Ensure parent dir exists — important in monorepo mode where the path can
  // be deeply nested (apps/web/.env.local). The actual write goes through
  // writeSecretFile so the plaintext lands with mode 0o600 even on a
  // --force overwrite of a pre-existing loose file.
  await mkdir(dirname(outPath), { recursive: true });
  await writeSecretFile(outPath, plaintext);

  const displayOut = relative(process.cwd(), outPath) || basename(outPath);
  success(`Pulled ${c.cyan(meta.environmentSlug)} v${meta.version} → ${displayOut}`);
  muted(`Mode 0600. ${plaintext.length} bytes plaintext.`);
  if (!noGitignoreHint) {
    warn(`Make sure ${displayOut} is gitignored.`);
  }
}

function resolveEnvForEntry(file: EnvstoreFileEntry): string {
  if (file.environment) return file.environment;
  const det = detectEnvironmentFromFilename(file.path);
  if (det.detected) return det.slug;
  return DEFAULT_ENV_SLUG;
}

function stringFlag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
