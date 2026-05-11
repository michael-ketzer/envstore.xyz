import { join } from 'node:path';
import { homedir } from 'node:os';

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

export function defaultApiUrl(): string {
  return process.env.ENVSTORE_API_URL ?? 'https://www.envstore.xyz';
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

export const CLI_VERSION = '0.2.2';
