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
