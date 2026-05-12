import { describe, expect, test } from 'bun:test';

import {
  envstoreConfigSchema,
  isMultiConfig,
  normalizeToFiles,
} from './envstore-config';

describe('envstoreConfigSchema', () => {
  test('parses a flat single-project config', () => {
    const parsed = envstoreConfigSchema.parse({
      workspace: 'my-team',
      project: 'api',
    });
    expect(parsed).toMatchObject({ workspace: 'my-team', project: 'api', version: 1 });
    expect(isMultiConfig(parsed)).toBe(false);
  });

  test('parses a multi (monorepo) config with files[]', () => {
    const parsed = envstoreConfigSchema.parse({
      workspace: 'my-team',
      files: [
        { path: 'apps/web/.env', project: 'web' },
        { path: 'apps/api/.env', project: 'api', environment: 'production' },
      ],
    });
    expect(isMultiConfig(parsed)).toBe(true);
    if (isMultiConfig(parsed)) {
      expect(parsed.files).toHaveLength(2);
      expect(parsed.files[1]?.environment).toBe('production');
    }
  });

  test('rejects a multi config with an empty files[]', () => {
    expect(() =>
      envstoreConfigSchema.parse({ workspace: 'my-team', files: [] }),
    ).toThrow();
  });

  test('rejects a config missing required fields', () => {
    expect(() => envstoreConfigSchema.parse({ workspace: 'my-team' })).toThrow();
    expect(() => envstoreConfigSchema.parse({ project: 'api' })).toThrow();
  });

  test('accepts an optional apiUrl on either shape', () => {
    const flat = envstoreConfigSchema.parse({
      workspace: 'my-team',
      project: 'api',
      apiUrl: 'https://envstore.example.com',
    });
    expect(flat.apiUrl).toBe('https://envstore.example.com');
  });

  test('rejects http:// for non-loopback hosts', () => {
    expect(() =>
      envstoreConfigSchema.parse({
        workspace: 'my-team',
        project: 'api',
        apiUrl: 'http://attacker.example.com',
      }),
    ).toThrow();
  });

  test('accepts http://localhost and http://127.0.0.1 for dev', () => {
    for (const apiUrl of [
      'http://localhost:3000',
      'http://localhost',
      'http://127.0.0.1:8787',
    ]) {
      expect(() =>
        envstoreConfigSchema.parse({ workspace: 'ws', project: 'pj', apiUrl }),
      ).not.toThrow();
    }
  });

  test('accepts http://[::1] (IPv6 loopback with WHATWG-style brackets)', () => {
    // Regression: Node's URL.hostname returns `[::1]` (with brackets) for
    // IPv6 literals, not `::1`. An earlier version of the refine check
    // compared against `::1` only and rejected this legitimate local-dev URL.
    for (const apiUrl of ['http://[::1]', 'http://[::1]:3000']) {
      expect(() =>
        envstoreConfigSchema.parse({ workspace: 'ws', project: 'pj', apiUrl }),
      ).not.toThrow();
    }
  });
});

describe('normalizeToFiles', () => {
  test('flat config synthesizes a single entry with .env path', () => {
    const cfg = envstoreConfigSchema.parse({ workspace: 'ws', project: 'pj' });
    expect(normalizeToFiles(cfg)).toEqual([
      { path: '.env', project: 'pj', environment: undefined },
    ]);
  });

  test('flat config honors defaultEnv in the synthesized entry', () => {
    const cfg = envstoreConfigSchema.parse({
      workspace: 'ws',
      project: 'pj',
      defaultEnv: 'production',
    });
    expect(normalizeToFiles(cfg)).toEqual([
      { path: '.env', project: 'pj', environment: 'production' },
    ]);
  });

  test('multi config returns the files[] verbatim', () => {
    const files = [
      { path: 'apps/web/.env', project: 'web' },
      { path: 'apps/api/.env', project: 'api', environment: 'staging' },
    ];
    const cfg = envstoreConfigSchema.parse({ workspace: 'ws', files });
    expect(normalizeToFiles(cfg)).toEqual(files);
  });
});
