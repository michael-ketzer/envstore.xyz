// `envstore pull [env]` — download + decrypt an env file.
//
// Defaults:
//   - env: positional arg → --env flag → envstore.json defaultEnv → "development"
//   - output filename: `.env.<env>` (except `development` → `.env`), overridable via --out
//   - version: --version <int> for a specific version, omit for current
//
// Refuses to overwrite an existing file unless --force.

import { chmod, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decryptToString } from '@envstore/crypto/age';
import { sha256Hex } from '@envstore/crypto/hash';
import { defaultFilenameForEnvironment, validateSlug } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
import { loadIdentity } from '../lib/identity';
import { c, info, muted, success, warn } from '../lib/output';

type PullResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  ciphertextSize: number;
  ciphertextSha256: string;
  recipientsHash: string;
  downloadUrl: string;
  expiresIn: number;
};

const DEFAULT_ENV_SLUG = 'development';

export async function pull(args: Args): Promise<void> {
  // ----- 1. Project config -----
  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root first.',
    });
  }
  const { workspace, project, defaultEnv } = cfg.config;

  // ----- 2. Resolve env (positional > --env > envstore.json defaultEnv > development) -----
  const envFromFlag =
    typeof args.flags['env'] === 'string' ? args.flags['env'] : undefined;
  const envSlug =
    args.positional[0] ?? envFromFlag ?? defaultEnv ?? DEFAULT_ENV_SLUG;
  const slugCheck = validateSlug(envSlug);
  if (!slugCheck.ok) {
    throw new CliError(`Invalid environment slug "${envSlug}": ${slugCheck.reason}`);
  }

  // ----- 3. Identity (must exist before we waste API calls) -----
  const identity = await loadIdentity();
  if (!identity) {
    throw new CliError('No local identity found.', {
      hint: 'Run `envstore identity init` (or `envstore identity import`) first.',
    });
  }

  // ----- 4. Get presigned download URL -----
  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const versionParam = args.flags['version'];
  const qs = new URLSearchParams({ env: envSlug });
  if (typeof versionParam === 'string') qs.set('version', versionParam);
  const meta = await client.get<PullResponse>(
    `/api/v1/workspaces/${workspace}/projects/${project}/pull?${qs.toString()}`,
  );

  // ----- 5. Download ciphertext from R2 -----
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

  // ----- 6. Decrypt with local identity -----
  let plaintext;
  try {
    plaintext = await decryptToString(ciphertext, identity.identity);
  } catch (err) {
    throw new CliError(
      `Decryption failed: ${(err as Error).message}`,
      {
        hint:
          'Your local identity may not be in this version\'s recipient set. ' +
          'Ask a teammate to re-push after adding your recipient via the dashboard.',
      },
    );
  }

  // ----- 7. Write to disk -----
  const outPath = resolve(
    process.cwd(),
    typeof args.flags['out'] === 'string'
      ? args.flags['out']
      : defaultFilenameForEnvironment(meta.environmentSlug),
  );
  if (!args.flags['force']) {
    try {
      await stat(outPath);
      throw new CliError(`${outPath} already exists.`, {
        hint: 'Pass --force to overwrite, or --out <path> for a different filename.',
      });
    } catch (err) {
      // ENOENT means it doesn't exist — that's what we want.
      if (err instanceof CliError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  await writeFile(outPath, plaintext);
  await chmod(outPath, 0o600);

  success(`Pulled ${c.cyan(meta.environmentSlug)} v${meta.version} → ${outPath}`);
  muted(`Mode 0600. ${plaintext.length} bytes plaintext.`);
  if (!args.flags['no-gitignore-hint']) {
    warn(`Make sure ${outPath.replace(process.cwd() + '/', '')} is gitignored.`);
  }
}
