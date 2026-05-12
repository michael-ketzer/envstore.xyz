// Tests for resolveApiUrl — specifically the F1 (CI-token vs config-file URL)
// safety check that prevents a malicious envstore.json from redirecting a
// CI-supplied ENVSTORE_TOKEN to an attacker-controlled host.
//
// We exercise the precedence env > project > global > canonical, the
// canonical-alias acceptance (apex + www), and the refusal-with-ENVSTORE_TOKEN
// branch. The global-config branch is exercised by pointing XDG_CONFIG_HOME
// at a temp dir and writing a config.json — keeps the test against the real
// filesystem rather than mocked behavior.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EnvstoreConfig } from '@envstore/shared';

import { resolveApiUrl } from './config';

let originalEnv: NodeJS.ProcessEnv;
let tmpHome: string;

beforeEach(async () => {
  originalEnv = { ...process.env };
  tmpHome = await import('node:fs/promises').then((m) =>
    m.mkdtemp(join(tmpdir(), 'envstore-config-test-')),
  );
  // Point XDG_CONFIG_HOME at the tmpHome so loadGlobalConfig() reads from a
  // clean per-test directory, never touching the developer's real config.
  process.env.XDG_CONFIG_HOME = tmpHome;
  delete process.env.ENVSTORE_API_URL;
  delete process.env.ENVSTORE_TOKEN;
});

afterEach(async () => {
  process.env = originalEnv;
  await rm(tmpHome, { recursive: true, force: true });
});

function makeConfig(apiUrl?: string): EnvstoreConfig {
  return {
    workspace: 'ws',
    project: 'pj',
    version: 1,
    ...(apiUrl ? { apiUrl } : {}),
  } as EnvstoreConfig;
}

async function writeGlobalConfig(apiUrl: string): Promise<void> {
  await mkdir(join(tmpHome, 'envstore'), { recursive: true });
  await writeFile(join(tmpHome, 'envstore', 'config.json'), JSON.stringify({ apiUrl }));
}

describe('resolveApiUrl — precedence', () => {
  test('env var wins over everything', async () => {
    process.env.ENVSTORE_API_URL = 'https://from-env.example';
    await writeGlobalConfig('https://from-global.example');
    const url = await resolveApiUrl({ project: makeConfig('https://from-project.example') });
    expect(url).toBe('https://from-env.example');
  });

  test('project config wins over global + default when env unset', async () => {
    await writeGlobalConfig('https://from-global.example');
    const url = await resolveApiUrl({ project: makeConfig('https://from-project.example') });
    expect(url).toBe('https://from-project.example');
  });

  test('global config wins over canonical default when env + project unset', async () => {
    await writeGlobalConfig('https://from-global.example');
    const url = await resolveApiUrl({ project: makeConfig() });
    expect(url).toBe('https://from-global.example');
  });

  test('falls back to the canonical default when nothing is configured', async () => {
    const url = await resolveApiUrl();
    expect(url).toBe('https://www.envstore.xyz');
  });

  test('strips trailing slashes from any source', async () => {
    process.env.ENVSTORE_API_URL = 'https://example.com///';
    const url = await resolveApiUrl();
    expect(url).toBe('https://example.com');
  });
});

describe('resolveApiUrl — F1 CI-token guard', () => {
  test('refuses to use envstore.json apiUrl when ENVSTORE_TOKEN is set and the URL is bespoke', async () => {
    process.env.ENVSTORE_TOKEN = 'eswtok_test';
    const project = makeConfig('https://attacker.example');
    await expect(resolveApiUrl({ project })).rejects.toThrow(
      /envstore\.json overrides apiUrl/i,
    );
  });

  test('error message mentions ENVSTORE_API_URL as the mitigation', async () => {
    process.env.ENVSTORE_TOKEN = 'eswtok_test';
    const project = makeConfig('https://attacker.example');
    await expect(resolveApiUrl({ project })).rejects.toThrow(/ENVSTORE_API_URL/);
  });

  test('allows envstore.json apiUrl when ENVSTORE_TOKEN is unset', async () => {
    const project = makeConfig('https://self-hosted.example');
    const url = await resolveApiUrl({ project });
    expect(url).toBe('https://self-hosted.example');
  });

  test('allows envstore.json apiUrl when ENVSTORE_API_URL is set (regardless of value match)', async () => {
    // The env-var branch returns early before the project-URL guard, so an
    // ENVSTORE_API_URL set in the workflow lets the CI run proceed even if
    // envstore.json names something else — the env var is the source of truth.
    process.env.ENVSTORE_TOKEN = 'eswtok_test';
    process.env.ENVSTORE_API_URL = 'https://self-hosted.example';
    const project = makeConfig('https://self-hosted.example');
    const url = await resolveApiUrl({ project });
    expect(url).toBe('https://self-hosted.example');
  });

  test('accepts the canonical envstore.xyz apex form even with ENVSTORE_TOKEN', async () => {
    // The docs + GitHub Action default to the apex (no www). A CI workflow
    // that pins envstore.json apiUrl to the apex must not trip the guard.
    process.env.ENVSTORE_TOKEN = 'eswtok_test';
    const project = makeConfig('https://envstore.xyz');
    const url = await resolveApiUrl({ project });
    expect(url).toBe('https://envstore.xyz');
  });

  test('accepts the canonical envstore.xyz www form even with ENVSTORE_TOKEN', async () => {
    process.env.ENVSTORE_TOKEN = 'eswtok_test';
    const project = makeConfig('https://www.envstore.xyz');
    const url = await resolveApiUrl({ project });
    expect(url).toBe('https://www.envstore.xyz');
  });

  test('does NOT block when project supplies no apiUrl (default fallback is fine in CI)', async () => {
    // ENVSTORE_TOKEN + no envstore.json apiUrl override → falls through to the
    // canonical default, which is exactly the common envstore.xyz CI shape.
    process.env.ENVSTORE_TOKEN = 'eswtok_test';
    const project = makeConfig();
    const url = await resolveApiUrl({ project });
    expect(url).toBe('https://www.envstore.xyz');
  });
});
