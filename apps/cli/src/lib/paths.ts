import { homedir } from 'node:os';
import { join } from 'node:path';

// XDG Base Directory paths, scoped to envstore.
export function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'envstore')
    : join(homedir(), '.config', 'envstore');
}

export function dataDir(): string {
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'envstore')
    : join(homedir(), '.local', 'share', 'envstore');
}

// The hosted envstore.xyz endpoint — used as the ultimate fallback. Existing
// installs have keychain credentials keyed under this `www.` form, so we
// keep it as the default to avoid orphaning anyone's saved token on
// upgrade. New install URLs in docs and the GitHub Action default to the
// apex form, so the safety check accepts both — see CANONICAL_API_URL_ALIASES.
export const CANONICAL_API_URL = 'https://www.envstore.xyz';

// Hostnames that point at the same hosted instance. The F1 (CI-token-vs-
// envstore.json) guard treats any of these as "the canonical envstore.xyz
// endpoint" — so a repo that pins `"apiUrl": "https://envstore.xyz"`
// alongside ENVSTORE_TOKEN doesn't trip the bearer-redirection check.
export const CANONICAL_API_URL_ALIASES: ReadonlySet<string> = new Set([
  CANONICAL_API_URL,
  'https://envstore.xyz',
]);

export function defaultApiUrl(): string {
  return process.env.ENVSTORE_API_URL ?? CANONICAL_API_URL;
}

export function configFile(): string {
  return join(configDir(), 'config.json');
}

export function credentialsFile(): string {
  return join(configDir(), 'credentials.json');
}

export function identityFile(): string {
  return join(configDir(), 'identity.age');
}

export const CLI_VERSION = '0.8.5';
