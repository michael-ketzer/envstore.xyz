// CLI token storage.
// Macs: macOS Keychain (service=envstore.token, account=<apiUrl>).
// Elsewhere or as fallback: ~/.config/envstore/credentials.json (mode 600).

import { mkdir, readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

import { credentialsFile, configDir } from './paths';
import {
  isKeychainAvailable,
  keychainDelete,
  keychainGet,
  keychainSet,
} from './keychain';

const KEYCHAIN_SERVICE = 'envstore.token';

type CredsFile = Record<string, { token: string; createdAt: string }>;

async function readFileCreds(): Promise<CredsFile> {
  try {
    const buf = await readFile(credentialsFile(), 'utf8');
    return JSON.parse(buf) as CredsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeFileCreds(data: CredsFile): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(credentialsFile(), JSON.stringify(data, null, 2));
  await chmod(credentialsFile(), 0o600);
}

export async function saveToken(apiUrl: string, token: string): Promise<void> {
  if (isKeychainAvailable()) {
    try {
      await keychainSet(KEYCHAIN_SERVICE, apiUrl, token);
      return;
    } catch {
      // Fall through to file storage if Keychain refuses.
    }
  }
  const existing = await readFileCreds();
  existing[apiUrl] = { token, createdAt: new Date().toISOString() };
  await writeFileCreds(existing);
}

export async function loadToken(apiUrl: string): Promise<string | null> {
  if (isKeychainAvailable()) {
    try {
      const v = await keychainGet(KEYCHAIN_SERVICE, apiUrl);
      if (v) return v;
    } catch {
      // continue to file fallback
    }
  }
  const existing = await readFileCreds();
  return existing[apiUrl]?.token ?? null;
}

export async function deleteToken(apiUrl: string): Promise<boolean> {
  let removed = false;
  if (isKeychainAvailable()) {
    try {
      if (await keychainDelete(KEYCHAIN_SERVICE, apiUrl)) removed = true;
    } catch {
      // ignore
    }
  }
  const existing = await readFileCreds();
  if (existing[apiUrl]) {
    delete existing[apiUrl];
    if (Object.keys(existing).length === 0) {
      try {
        await unlink(credentialsFile());
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    } else {
      await writeFileCreds(existing);
    }
    removed = true;
  }
  return removed;
}

// Ensures the parent directory of a config file exists.
export async function ensureConfigDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
