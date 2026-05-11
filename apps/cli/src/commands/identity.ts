// `envstore identity <subcommand>` — local key management + recipient registration.
//
//   init     Generate a new age keypair, store it locally, register the public
//            recipient with the server. Refuses to clobber an existing identity.
//   export   Write the local secret key to a file (mode 0600).
//   import   Replace local identity from a file.
//   register Push the existing local recipient up to the server again (after
//            registering on a new machine, or when adding additional recipients).
//   show     Print the public recipient.

import { hostname } from 'node:os';

import { detectRecipientKind } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { copyToClipboard, readFromClipboard } from '../lib/clipboard';
import { resolveApiUrl } from '../lib/config';
import { CliError, UsageError } from '../lib/errors';
import {
  deleteIdentity,
  exportIdentityToFile,
  generateAndStoreIdentity,
  getExportableIdentity,
  importIdentityFromFile,
  importIdentityFromText,
  loadIdentity,
} from '../lib/identity';
import type { MeRecipient } from '../lib/me';
import { c, heading, info, muted, success, warn } from '../lib/output';

async function registerRecipient(recipient: string, label: string): Promise<MeRecipient> {
  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);
  const kind = detectRecipientKind(recipient);
  if (!kind) throw new CliError(`Unrecognized recipient format: ${recipient}`);
  return client.post<MeRecipient>('/api/v1/me/recipients', { recipient, kind, label });
}

export async function identity(args: Args): Promise<void> {
  const [sub, ...rest] = args.positional;
  switch (sub) {
    case undefined:
    case 'show':
      return identityShow();
    case 'init':
      return identityInit(args);
    case 'export':
      return identityExport(args);
    case 'import':
      return identityImport(args);
    case 'register':
      return identityRegister(args);
    case 'remove':
      return identityRemove(args);
    default:
      throw new UsageError(
        `Unknown subcommand: identity ${sub}`,
        'Try: envstore identity [init|show|export|import|register|remove]',
      );
  }
}

async function identityShow(): Promise<void> {
  const stored = await loadIdentity();
  if (!stored) {
    muted('No local identity. Run `envstore identity init`.');
    return;
  }
  heading('Public recipient (safe to share):');
  console.log(`  ${stored.recipient}`);
  muted(`  stored in ${stored.source}`);
}

async function identityInit(args: Args): Promise<void> {
  const existing = await loadIdentity();
  if (existing && !args.flags['force']) {
    throw new CliError(
      'An identity is already set up on this machine.',
      {
        hint:
          'Use `envstore identity show` to view it, or `envstore identity init --force` to replace it (your previous secret key is overwritten).',
      },
    );
  }

  info('Generating age keypair locally…');
  const stored = await generateAndStoreIdentity();

  const label =
    (typeof args.flags['label'] === 'string' && args.flags['label']) || hostname();

  info('Registering public recipient with the server…');
  const reg = await registerRecipient(stored.recipient, label);

  success('Identity ready.');
  console.log(`  ${c.gray('public:')}    ${stored.recipient}`);
  console.log(`  ${c.gray('storage:')}   ${stored.source}`);
  console.log(`  ${c.gray('label:')}     ${reg.label}`);
  console.log();
  warn(
    'Your secret key never leaves this machine. If you lose it, files encrypted ONLY to this recipient are unrecoverable. Export a backup: `envstore identity export ~/envstore-identity.age`',
  );
}

async function identityExport(args: Args): Promise<void> {
  // identity export <path>           → write to file (mode 0600)
  // identity export --clipboard      → copy to clipboard + show Apple-Passwords instructions
  // identity export                  → ambiguous, surface a usage hint
  const wantClipboard = Boolean(args.flags['clipboard']);
  const path = args.positional[1];

  if (wantClipboard && path) {
    throw new UsageError('Use either `--clipboard` or a file path, not both.');
  }

  if (wantClipboard) {
    const { stored, payload } = await getExportableIdentity();
    const copied = await copyToClipboard(payload);
    if (!copied) {
      // No clipboard tool — print the payload so the user can copy manually.
      warn('No clipboard tool available on this system. Printing identity below — copy it yourself.');
      console.log();
      console.log(payload);
      return;
    }
    success('Identity copied to clipboard.');
    console.log(`  ${c.gray('public:')} ${stored.recipient}`);
    console.log();
    if (process.platform === 'darwin') {
      heading('Save it to Apple Passwords (Cmd+Space → "Passwords"):');
      console.log(`  1. Click ${c.cyan('+')} → ${c.cyan('New password')} (or New Note).`);
      console.log(`  2. Title: ${c.cyan('envstore identity')}`);
      console.log(`  3. Paste into the notes/password field.`);
      console.log(`  4. Save. It syncs to your other Apple devices via iCloud Keychain.`);
      console.log();
      muted('Or paste into 1Password, Bitwarden, KeePassXC — any password manager works.');
    } else {
      muted('Paste into your password manager of choice. Anyone with this text can decrypt your files.');
    }
    return;
  }

  if (!path) {
    throw new UsageError(
      'Usage: envstore identity export <path>  OR  envstore identity export --clipboard',
    );
  }
  await exportIdentityToFile(path);
  success(`Wrote ${path} (mode 0600).`);
  warn('Keep this file safe. Anyone with it can decrypt files encrypted to your recipient.');
}

async function identityImport(args: Args): Promise<void> {
  // identity import <file>           → read from file
  // identity import -                → read from stdin (for `pbpaste | envstore identity import -`)
  // identity import --clipboard      → read from system clipboard
  const wantClipboard = Boolean(args.flags['clipboard']);
  const path = args.positional[1];

  if (wantClipboard && path) {
    throw new UsageError('Use either `--clipboard` or a file path, not both.');
  }

  let stored;
  if (wantClipboard) {
    const text = await readFromClipboard();
    if (!text) {
      throw new CliError('Could not read from clipboard.', {
        hint:
          process.platform === 'linux'
            ? 'Install `wl-paste`, `xclip`, or `xsel`. Or pipe the key in: `pbpaste | envstore identity import -`.'
            : 'Try piping the key in instead: `pbpaste | envstore identity import -`.',
      });
    }
    stored = await importIdentityFromText(text);
  } else if (path === '-') {
    // Read the whole stdin stream — `bun` exposes node:stream/consumers.
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) {
      throw new CliError('Empty stdin.', {
        hint: 'Pipe the key in, e.g. `pbpaste | envstore identity import -`.',
      });
    }
    stored = await importIdentityFromText(text);
  } else if (path) {
    stored = await importIdentityFromFile(path);
  } else {
    throw new UsageError(
      'Usage: envstore identity import <file>  OR  --clipboard  OR  - (read stdin)',
    );
  }

  success(`Imported identity (stored in ${stored.source}).`);
  console.log(`  ${c.gray('public:')} ${stored.recipient}`);
  muted('Register this recipient with the server next: `envstore identity register`');
}

async function identityRegister(args: Args): Promise<void> {
  const stored = await loadIdentity();
  if (!stored) {
    throw new CliError('No local identity. Run `envstore identity init` first.');
  }
  const label =
    (typeof args.flags['label'] === 'string' && args.flags['label']) || hostname();
  const reg = await registerRecipient(stored.recipient, label);
  success(`Registered ${stored.recipient} as "${reg.label}".`);
}

async function identityRemove(args: Args): Promise<void> {
  if (!args.flags['yes']) {
    throw new CliError(
      'This wipes the local secret key — files encrypted only to this recipient become unrecoverable from this machine.',
      {
        hint: 'Re-run with `--yes` to confirm.',
      },
    );
  }
  const removed = await deleteIdentity();
  if (removed) {
    success('Local identity removed.');
    muted('The recipient is still registered on the server — revoke it from the dashboard if you want to remove access entirely.');
  } else {
    muted('No local identity to remove.');
  }
}
