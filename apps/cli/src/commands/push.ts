// `envstore push [file]` — encrypt + upload a local env file.
//
// Flow:
//   1. Read the file (default `.env`).
//   2. Text-only check + size cap (refuses binaries and >1MB plaintext).
//   3. Resolve target environment:
//        - --env <slug>: explicit, wins.
//        - filename like `.env.production`: silent auto-detect.
//        - bare `.env` (or `.env.local`): PROMPT with default `development`.
//   4. Fetch workspace recipients, encrypt with age.
//   5. POST /push -> presigned PUT URL.
//   6. PUT the ciphertext directly to R2.
//   7. POST /push/<versionId>/finalize.

import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import { encryptForRecipients } from '@envstore/crypto/age';
import { recipientsHashHex, sha256Hex } from '@envstore/crypto/hash';
import {
  LIMITS,
  checkPlaintextSize,
  detectEnvironmentFromFilename,
  isText,
  validateSlug,
} from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { ApiError, CliError } from '../lib/errors';
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
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
};

type RecipientsResponse = { recipients: Recipient[] };

export async function push(args: Args): Promise<void> {
  // ----- 1. Project config -----
  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root first.',
    });
  }
  const { workspace, project } = cfg.config;

  // ----- 2. Read file -----
  const fileArg = args.positional[0] ?? '.env';
  const filePath = isAbsolute(fileArg) ? fileArg : resolve(process.cwd(), fileArg);
  let plaintext: Uint8Array;
  try {
    plaintext = await readFile(filePath);
  } catch (err) {
    throw new CliError(`Cannot read ${fileArg}: ${(err as Error).message}`);
  }

  // ----- 3. Text + size guards -----
  const text = isText(plaintext);
  if (!text.ok) {
    throw new CliError(
      `${fileArg} doesn't look like text (${text.reason}). envstore only accepts text files.`,
    );
  }
  const sizeCheck = checkPlaintextSize(plaintext.byteLength);
  if (sizeCheck.level === 'too-large') {
    throw new CliError(
      `${fileArg} is ${plaintext.byteLength} bytes; cap is ${LIMITS.maxPlaintextBytes} bytes.`,
    );
  }
  if (sizeCheck.level === 'soft-warn') {
    requireTty();
    warn(
      `${fileArg} is ${plaintext.byteLength} bytes — unusually large for an env file.`,
    );
    if (!askConfirm('Push anyway?', false)) throw new CliError('Cancelled.');
  }

  // ----- 4. Resolve target environment -----
  const envSlug = await resolveTargetEnv(fileArg, args);

  // ----- 5. Recipients -----
  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
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
  const recipientStrings = recipientsResponse.recipients.map((r) => r.recipient);
  const dedupedRecipients = Array.from(new Set(recipientStrings));

  // ----- 6. Encrypt -----
  info(
    `Encrypting ${c.cyan(basename(filePath))} to ${dedupedRecipients.length} recipient${
      dedupedRecipients.length === 1 ? '' : 's'
    }…`,
  );
  const ciphertext = await encryptForRecipients(plaintext, dedupedRecipients);
  if (ciphertext.byteLength > LIMITS.maxCiphertextBytes) {
    throw new CliError(
      `Ciphertext is ${ciphertext.byteLength} bytes; server cap is ${LIMITS.maxCiphertextBytes}.`,
    );
  }
  const ciphertextSha256 = await sha256Hex(ciphertext);
  const recipientsHash = await recipientsHashHex(dedupedRecipients);

  // ----- 7. Init push (auto-creates env if needed) -----
  const init = await client.post<PushInitResponse>(
    `/api/v1/workspaces/${workspace}/projects/${project}/push`,
    {
      env: envSlug,
      ciphertextSize: ciphertext.byteLength,
      ciphertextSha256,
      recipientsHash,
      comment:
        typeof args.flags['comment'] === 'string' ? args.flags['comment'] : undefined,
    },
  );

  // ----- 8. Upload ciphertext to R2 -----
  info(`Uploading v${init.version} (${ciphertext.byteLength} bytes)…`);
  const putRes = await fetch(init.uploadUrl, {
    method: 'PUT',
    body: ciphertext,
    headers: init.requiredHeaders,
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    throw new ApiError(
      `R2 upload failed: HTTP ${putRes.status}${text ? ` — ${text.slice(0, 120)}` : ''}`,
      putRes.status,
    );
  }

  // ----- 9. Finalize -----
  await client.post(
    `/api/v1/workspaces/${workspace}/projects/${project}/push/${init.versionId}/finalize`,
    {},
  );

  success(
    `Pushed ${c.cyan(`${workspace}/${project}`)} → ${c.cyan(init.environmentSlug)} (v${init.version}).`,
  );
  muted(`On another machine: \`envstore pull${init.environmentSlug === 'development' ? '' : ` ${init.environmentSlug}`}\``);
}

async function resolveTargetEnv(file: string, args: Args): Promise<string> {
  // Explicit --env wins.
  const flag = typeof args.flags['env'] === 'string' ? args.flags['env'] : undefined;
  if (flag) {
    const r = validateSlug(flag);
    if (!r.ok) throw new CliError(`--env ${flag}: ${r.reason}`);
    return flag;
  }

  const base = basename(file);
  // Bare `.env` or `.env.local` (override file with no env qualifier) → prompt.
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

  // `.env.<name>` → silent auto-detect.
  const det = detectEnvironmentFromFilename(file);
  if (det.detected) return det.slug;

  // Fallback: prompt.
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
