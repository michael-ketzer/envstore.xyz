// Two configs:
// - envstore.json — repo-local. Found by walking up from cwd. Defines workspace + project.
// - ~/.config/envstore/config.json — global. Stores the chosen API URL and (later)
//   per-instance defaults.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ENVSTORE_CONFIG_FILENAME, envstoreConfigSchema, type EnvstoreConfig } from '@envstore/shared';

import { CliError } from './errors';
import { CANONICAL_API_URL_ALIASES, configDir, configFile, defaultApiUrl } from './paths';

// ---------- envstore.json (repo-local) ----------

export type ProjectConfig = { config: EnvstoreConfig; path: string };

export async function findProjectConfig(startDir = process.cwd()): Promise<ProjectConfig | null> {
  let dir = startDir;
  for (let i = 0; i < 32; i++) {
    const candidate = join(dir, ENVSTORE_CONFIG_FILENAME);
    try {
      const s = await stat(candidate);
      if (s.isFile()) {
        const raw = await readFile(candidate, 'utf8');
        const parsed = envstoreConfigSchema.parse(JSON.parse(raw));
        return { config: parsed, path: candidate };
      }
    } catch {
      // continue walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function writeProjectConfig(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

// ---------- Global config ----------

export type GlobalConfig = {
  apiUrl?: string;
};

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(configFile(), 'utf8');
    return JSON.parse(raw) as GlobalConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveGlobalConfig(cfg: GlobalConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configFile(), JSON.stringify(cfg, null, 2));
}

// Resolved API URL precedence: env var → envstore.json's apiUrl → global config → default.
//
// Safety: a committed envstore.json that points apiUrl somewhere bespoke could
// redirect ENVSTORE_TOKEN in a malicious PR. We allow project-supplied URLs
// only when (a) there's no token in the env, or (b) the URL is the canonical
// hosted endpoint, or (c) ENVSTORE_API_URL also pins the same host (i.e. the
// CI workflow explicitly authorized the destination). Self-hosters in CI must
// pin ENVSTORE_API_URL alongside ENVSTORE_TOKEN as a secret — otherwise a PR
// editing envstore.json could redirect the bearer to an attacker host.
export async function resolveApiUrl(opts?: { project?: EnvstoreConfig | null }): Promise<string> {
  const envUrl = process.env.ENVSTORE_API_URL?.replace(/\/+$/, '');
  if (envUrl) return envUrl;

  const projectUrl = opts?.project?.apiUrl?.replace(/\/+$/, '');
  if (projectUrl) {
    const hasCiToken = Boolean(process.env.ENVSTORE_TOKEN?.trim());
    if (hasCiToken && !CANONICAL_API_URL_ALIASES.has(projectUrl)) {
      throw new CliError(
        `envstore.json overrides apiUrl to ${projectUrl}, but ENVSTORE_TOKEN is set without a matching ENVSTORE_API_URL.`,
        {
          hint:
            'In CI, pin ENVSTORE_API_URL alongside ENVSTORE_TOKEN as a secret — ' +
            'otherwise a PR editing envstore.json could redirect the bearer to an attacker host.',
        },
      );
    }
    return projectUrl;
  }

  const global = await loadGlobalConfig();
  if (global.apiUrl) return global.apiUrl.replace(/\/+$/, '');
  return defaultApiUrl();
}
