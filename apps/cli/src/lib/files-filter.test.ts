import { describe, expect, test } from 'bun:test';

import type { EnvstoreFileEntry } from '@envstore/shared';

import { matchFiles } from './files-filter';

// A representative monorepo file list. Tests filter against this fixed set.
const FILES: EnvstoreFileEntry[] = [
  { path: 'apps/web/.env.local', project: 'web', environment: 'development' },
  { path: 'apps/web/.env.production', project: 'web', environment: 'production' },
  { path: 'apps/api/.env', project: 'api', environment: 'production' },
  { path: 'services/worker/.env', project: 'worker' },
];

// Use a stable configDir so path resolution is predictable across runners.
const CONFIG_DIR = '/repo';

describe('matchFiles', () => {
  test('no filters → returns every entry verbatim', () => {
    expect(matchFiles(FILES, {}, CONFIG_DIR)).toEqual(FILES);
  });

  test('project filter narrows by exact slug', () => {
    const out = matchFiles(FILES, { project: 'web' }, CONFIG_DIR);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.project === 'web')).toBe(true);
  });

  test('env filter narrows by exact environment slug', () => {
    const out = matchFiles(FILES, { env: 'production' }, CONFIG_DIR);
    expect(out.map((f) => f.path)).toEqual([
      'apps/web/.env.production',
      'apps/api/.env',
    ]);
  });

  test('project + env filters AND together', () => {
    const out = matchFiles(
      FILES,
      { project: 'web', env: 'production' },
      CONFIG_DIR,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe('apps/web/.env.production');
  });

  test('path filter matches an exact absolute file path', () => {
    const out = matchFiles(
      FILES,
      { path: '/repo/apps/web/.env.production' },
      CONFIG_DIR,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe('apps/web/.env.production');
  });

  test('path filter as a directory prefix matches every file beneath it', () => {
    const out = matchFiles(FILES, { path: '/repo/apps/web' }, CONFIG_DIR);
    expect(out.map((f) => f.path)).toEqual([
      'apps/web/.env.local',
      'apps/web/.env.production',
    ]);
  });

  test('path filter that matches nothing returns empty array', () => {
    const out = matchFiles(FILES, { path: '/repo/nope' }, CONFIG_DIR);
    expect(out).toEqual([]);
  });

  test('unmet project filter still returns empty even if path matches', () => {
    const out = matchFiles(
      FILES,
      { project: 'api', path: '/repo/apps/web' },
      CONFIG_DIR,
    );
    expect(out).toEqual([]);
  });

  test('env filter on entries without an `environment` field excludes them', () => {
    const out = matchFiles(FILES, { env: 'development' }, CONFIG_DIR);
    // services/worker/.env has no environment, so the env filter excludes it.
    expect(out.map((f) => f.path)).toEqual(['apps/web/.env.local']);
  });
});
