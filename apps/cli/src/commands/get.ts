// `envstore get KEY` — print one variable's value from the latest pushed env.
//
// Cheap composability for shell scripts: `export PG=$(envstore get DB_URL)`.
// Decrypts in memory only — never writes the value to disk, never logs it.
//
//   envstore get DB_URL                 → flat mode: project from envstore.json
//   envstore get DB_URL --env staging   → override env (default: defaultEnv or development)
//   envstore get DB_URL --project shinra-api --env staging   → required in monorepo mode
//   envstore get DB_URL --newline       → append a newline (default: no trailing newline)

import { decryptToString } from '@envstore/crypto/age';
import { sha256Hex } from '@envstore/crypto/hash';
import {
  dotenvLookup,
  isMultiConfig,
  parseDotenv,
  validateSlug,
  type EnvstoreConfig,
} from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
import { loadIdentity } from '../lib/identity';

const DEFAULT_ENV_SLUG = 'development';

type PullResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  ciphertextSize: number;
  ciphertextSha256: string;
  downloadUrl: string;
};

export async function get(args: Args): Promise<void> {
  const key = args.positional[0];
  if (!key) {
    throw new CliError('Usage: envstore get <KEY>', {
      hint: 'Example: `envstore get DATABASE_URL --env staging`',
    });
  }

  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root first.',
    });
  }

  const identity = await loadIdentity();
  if (!identity) {
    throw new CliError('No local identity found.', {
      hint: 'Run `envstore identity init` (or `envstore identity import`) first.',
    });
  }

  const { projectSlug, envSlug } = resolveTarget(cfg.config, args);
  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const workspace = cfg.config.workspace;

  const qs = new URLSearchParams({ env: envSlug });
  let meta: PullResponse;
  try {
    meta = await client.get<PullResponse>(
      `/api/v1/workspaces/${workspace}/projects/${projectSlug}/pull?${qs.toString()}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new CliError(`No pushed version for ${workspace}/${projectSlug}/${envSlug}.`, {
        hint: 'Run `envstore push` after `envstore set` once to seed the env.',
      });
    }
    throw err;
  }

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
  if ((await sha256Hex(ciphertext)) !== meta.ciphertextSha256) {
    throw new CliError(
      'Ciphertext hash mismatch — the bytes from R2 do not match what the server recorded. Refusing to decrypt.',
    );
  }

  let plaintext: string;
  try {
    plaintext = await decryptToString(ciphertext, identity.identity);
  } catch (err) {
    throw new CliError(`Decryption failed: ${(err as Error).message}`, {
      hint:
        "Your local identity may not be in this version's recipient set. " +
        'Ask a teammate to re-push after adding your recipient via the dashboard.',
    });
  }

  const value = dotenvLookup(parseDotenv(plaintext), key);
  if (value === undefined) {
    throw new CliError(`Key "${key}" not set in ${meta.environmentSlug} v${meta.version}.`);
  }

  process.stdout.write(value);
  if (args.flags['newline']) process.stdout.write('\n');
}

function resolveTarget(cfg: EnvstoreConfig, args: Args): { projectSlug: string; envSlug: string } {
  const envFlag = stringFlag(args.flags['env']);
  const projectFlag = stringFlag(args.flags['project']);

  if (isMultiConfig(cfg)) {
    if (!projectFlag) {
      throw new CliError('--project is required in monorepo mode.', {
        hint: `Configured projects: ${Array.from(new Set(cfg.files.map((f) => f.project))).join(', ')}`,
      });
    }
    if (!envFlag) {
      throw new CliError('--env is required in monorepo mode.');
    }
    const slugCheck = validateSlug(envFlag);
    if (!slugCheck.ok) throw new CliError(`--env ${envFlag}: ${slugCheck.reason}`);
    return { projectSlug: projectFlag, envSlug: envFlag };
  }

  const envSlug = envFlag ?? cfg.defaultEnv ?? DEFAULT_ENV_SLUG;
  const slugCheck = validateSlug(envSlug);
  if (!slugCheck.ok) throw new CliError(`Invalid env "${envSlug}": ${slugCheck.reason}`);
  return { projectSlug: cfg.project, envSlug };
}

function stringFlag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
