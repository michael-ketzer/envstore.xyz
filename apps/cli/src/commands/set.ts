// `envstore set KEY=value` — change one variable end-to-end.
//
// Pull the current ciphertext → decrypt → modify → re-encrypt → push.
// On a fresh environment (no version yet) the pull 404s and we start from
// an empty plaintext, so `set` doubles as "seed this env's first variable."
//
//   envstore set DATABASE_URL=postgres://...
//   envstore set DATABASE_URL --from-stdin           # value from stdin (avoids argv leak)
//   envstore set FOO=bar --env staging
//   envstore set FOO=bar --project shinra-api --env staging  # monorepo mode
//   envstore set FOO=bar --comment "rotated by mk"
//
// Race note: two simultaneous `set` calls will produce two distinct versions
// where the later one wins. This matches `push`'s existing semantics — there
// is no CAS today.

import { decryptToString, encryptForRecipients } from '@envstore/crypto/age';
import { recipientsHashHex, sha256Hex } from '@envstore/crypto/hash';
import {
  LIMITS,
  dotenvSet,
  isMultiConfig,
  parseDotenv,
  serializeDotenv,
  validateSlug,
  type EnvstoreConfig,
} from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
import { loadIdentity } from '../lib/identity';
import { c, info, success } from '../lib/output';
import { applyTrustDecision, type RecipientInfo } from '../lib/trust';

const DEFAULT_ENV_SLUG = 'development';

type RecipientsResponse = { recipients: RecipientInfo[] };

type PullResponse = {
  ciphertextSize: number;
  ciphertextSha256: string;
  downloadUrl: string;
};

type PushInitResponse = {
  versionId: string;
  version: number;
  environmentSlug: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
};

export async function set(args: Args): Promise<void> {
  const { key, value } = await parseKeyValueArg(args);

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
  const trustNew = Boolean(args.flags['trust-new']);
  const comment = typeof args.flags['comment'] === 'string' ? args.flags['comment'] : undefined;

  // ---- 1. Fetch recipients (with TOFU trust check) ----
  const recipientsRes = await client.get<RecipientsResponse>(
    `/api/v1/workspaces/${workspace}/recipients?project=${encodeURIComponent(projectSlug)}`,
  );
  if (recipientsRes.recipients.length === 0) {
    throw new CliError(`No recipients registered on the server for ${workspace}/${projectSlug}.`, {
      hint: 'Run `envstore identity init` so the server knows your public recipient.',
    });
  }
  await applyTrustDecision({ apiUrl, workspace, project: projectSlug }, recipientsRes.recipients, {
    trustNew,
  });
  const recipients = Array.from(new Set(recipientsRes.recipients.map((r) => r.recipient)));

  // ---- 2. Try to pull current plaintext (404 = empty env, that's fine) ----
  let currentPlaintext = '';
  try {
    const meta = await client.get<PullResponse>(
      `/api/v1/workspaces/${workspace}/projects/${projectSlug}/pull?env=${encodeURIComponent(envSlug)}`,
    );
    currentPlaintext = await fetchAndDecrypt(meta, identity.identity);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
    // No version yet — start from empty. This is how `set` doubles as
    // "create the first variable in a fresh env."
    info(`Seeding fresh ${c.cyan(envSlug)} environment.`);
  }

  // ---- 3. Modify in place ----
  const updatedLines = dotenvSet(parseDotenv(currentPlaintext), key, value);
  const newPlaintext = serializeDotenv(updatedLines);

  // ---- 4. Encrypt + push ----
  const plaintextBytes = new TextEncoder().encode(newPlaintext);
  const ciphertext = await encryptForRecipients(plaintextBytes, recipients);
  if (ciphertext.byteLength > LIMITS.maxCiphertextBytes) {
    throw new CliError(
      `Ciphertext is ${ciphertext.byteLength} bytes; server cap is ${LIMITS.maxCiphertextBytes}.`,
    );
  }
  const ciphertextSha256 = await sha256Hex(ciphertext);
  const recipientsHash = await recipientsHashHex(recipients);

  const initRes = await client.post<PushInitResponse>(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/push`,
    {
      env: envSlug,
      ciphertextSize: ciphertext.byteLength,
      ciphertextSha256,
      recipientsHash,
      comment,
    },
  );

  const putRes = await fetch(initRes.uploadUrl, {
    method: 'PUT',
    body: ciphertext,
    headers: initRes.requiredHeaders,
  });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    throw new ApiError(
      `R2 upload failed: HTTP ${putRes.status}${errText ? ` — ${errText.slice(0, 120)}` : ''}`,
      putRes.status,
    );
  }

  await client.post(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/push/${initRes.versionId}/finalize`,
    {},
  );

  success(
    `Set ${c.cyan(key)} in ${c.cyan(`${projectSlug}/${initRes.environmentSlug}`)} (v${initRes.version}).`,
  );
}

async function parseKeyValueArg(args: Args): Promise<{ key: string; value: string }> {
  const arg = args.positional[0];
  if (!arg) {
    throw new CliError('Usage: envstore set <KEY>=<value>  (or <KEY> --from-stdin)');
  }

  if (args.flags['from-stdin']) {
    // The arg is just the KEY; value comes from stdin. Useful for secrets
    // you don't want to expose in argv (shell history, ps listings).
    const key = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    const value = await readAllStdin();
    return { key, value };
  }

  const eq = arg.indexOf('=');
  if (eq < 0) {
    throw new CliError(`Expected KEY=value, got "${arg}".`, {
      hint: 'Either pass `KEY=value`, or use `--from-stdin` to read the value from stdin.',
    });
  }
  return { key: arg.slice(0, eq), value: arg.slice(eq + 1) };
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliError('--from-stdin set, but stdin is a TTY.', {
      hint: 'Pipe a value in: `echo -n $VALUE | envstore set KEY --from-stdin`.',
    });
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Uint8Array);
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  let s = new TextDecoder().decode(buf);
  // Strip a single trailing newline — `echo` adds one by default and users
  // rarely mean to store it. If they do, `printf` (or our argv form) lets
  // them be explicit.
  if (s.endsWith('\n')) s = s.slice(0, -1);
  return s;
}

async function fetchAndDecrypt(meta: PullResponse, identityKey: string): Promise<string> {
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
    throw new CliError('Ciphertext hash mismatch — refusing to decrypt.');
  }
  try {
    return await decryptToString(ciphertext, identityKey);
  } catch (err) {
    throw new CliError(`Decryption failed: ${(err as Error).message}`, {
      hint: "Your local identity may not be in this version's recipient set.",
    });
  }
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
