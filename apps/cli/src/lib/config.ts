// Two configs:
// - envstore.json — repo-local. Found by walking up from cwd. Defines workspace + project.
// - ~/.config/envstore/config.json — global. Stores the chosen API URL and (later)
//   per-instance defaults.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ENVSTORE_CONFIG_FILENAME, envstoreConfigSchema, type EnvstoreConfig } from '@envstore/shared';

import { configDir, configFile, defaultApiUrl } from './paths';

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
export async function resolveApiUrl(opts?: { project?: EnvstoreConfig | null }): Promise<string> {
  if (process.env.ENVSTORE_API_URL) return process.env.ENVSTORE_API_URL.replace(/\/$/, '');
  if (opts?.project?.apiUrl) return opts.project.apiUrl.replace(/\/$/, '');
  const global = await loadGlobalConfig();
  if (global.apiUrl) return global.apiUrl.replace(/\/$/, '');
  return defaultApiUrl();
}
