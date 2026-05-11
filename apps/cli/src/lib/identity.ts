// Local age identity: generation, storage (Keychain or file), recipient export.
// The private identity NEVER leaves the user's machine. The PUBLIC recipient
// is what gets registered with the server.

import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

import { generateIdentity } from '@envstore/crypto/age';

import { configDir, identityFile } from './paths';
import {
  isKeychainAvailable,
  keychainDelete,
  keychainGet,
  keychainSet,
} from './keychain';

const KEYCHAIN_SERVICE = 'envstore.identity';
const KEYCHAIN_ACCOUNT = 'default';

export type StoredIdentity = {
  identity: string; // "AGE-SECRET-KEY-1..."
  recipient: string; // "age1..."
  source: 'keychain' | 'file';
};

export async function generateAndStoreIdentity(): Promise<StoredIdentity> {
  const { identity, recipient } = await generateIdentity();

  if (isKeychainAvailable()) {
    try {
      await keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, identity);
      return { identity, recipient, source: 'keychain' };
    } catch {
      // fall through to file
    }
  }

  await mkdir(configDir(), { recursive: true });
  const payload =
    `# created: ${new Date().toISOString()}\n` +
    `# public key: ${recipient}\n` +
    `${identity}\n`;
  await writeFile(identityFile(), payload);
  await chmod(identityFile(), 0o600);
  return { identity, recipient, source: 'file' };
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  if (isKeychainAvailable()) {
    try {
      const v = await keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (v) {
        const recipient = await deriveRecipient(v);
        return { identity: v, recipient, source: 'keychain' };
      }
    } catch {
      // continue to file
    }
  }
  try {
    const raw = await readFile(identityFile(), 'utf8');
    const identity = raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('AGE-SECRET-KEY-'));
    if (!identity) return null;
    const recipient = await deriveRecipient(identity);
    return { identity, recipient, source: 'file' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteIdentity(): Promise<boolean> {
  let removed = false;
  if (isKeychainAvailable()) {
    try {
      if (await keychainDelete(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)) removed = true;
    } catch {
      // ignore
    }
  }
  try {
    await unlink(identityFile());
    removed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return removed;
}

async function deriveRecipient(identity: string): Promise<string> {
  const age = await import('age-encryption');
  return age.identityToRecipient(identity);
}

// Canonical, paste-able representation of the identity for export.
// Includes the public key as a comment so the user can identify it later
// without exposing the secret key in plaintext logs.
export function formatExportableIdentity(stored: StoredIdentity): string {
  return (
    `# envstore identity export\n` +
    `# exported: ${new Date().toISOString()}\n` +
    `# public key: ${stored.recipient}\n` +
    `${stored.identity}\n`
  );
}

export async function exportIdentityToFile(path: string): Promise<void> {
  const stored = await loadIdentity();
  if (!stored) throw new Error('No identity to export. Run `envstore identity init` first.');
  await writeFile(path, formatExportableIdentity(stored));
  await chmod(path, 0o600);
}

export async function getExportableIdentity(): Promise<{ stored: StoredIdentity; payload: string }> {
  const stored = await loadIdentity();
  if (!stored) throw new Error('No identity to export. Run `envstore identity init` first.');
  return { stored, payload: formatExportableIdentity(stored) };
}

// Parse + store an identity from arbitrary text (file contents, clipboard,
// stdin). Liberal on input — the user may have pasted comments, surrounding
// whitespace, or multiple lines — we look for the first `AGE-SECRET-KEY-` line.
export async function importIdentityFromText(text: string): Promise<StoredIdentity> {
  const identity = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-'));
  if (!identity) {
    throw new Error(
      'No age secret key found in the input. Expected a line beginning with `AGE-SECRET-KEY-`.',
    );
  }
  const recipient = await deriveRecipient(identity);
  if (isKeychainAvailable()) {
    try {
      await keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, identity);
      return { identity, recipient, source: 'keychain' };
    } catch {
      // fall through to file
    }
  }
  await mkdir(configDir(), { recursive: true });
  await writeFile(identityFile(), `${identity}\n`);
  await chmod(identityFile(), 0o600);
  return { identity, recipient, source: 'file' };
}

export async function importIdentityFromFile(path: string): Promise<StoredIdentity> {
  const raw = await readFile(path, 'utf8');
  return importIdentityFromText(raw);
}
