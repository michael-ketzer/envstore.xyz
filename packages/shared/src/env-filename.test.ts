import { describe, expect, test } from 'bun:test';

import {
  defaultFilenameForEnvironment,
  detectEnvironmentFromFilename,
} from './env-filename';

describe('detectEnvironmentFromFilename', () => {
  test('bare .env → development (high confidence)', () => {
    expect(detectEnvironmentFromFilename('.env')).toEqual({
      detected: true,
      slug: 'development',
      confidence: 'high',
    });
  });

  test('.env.local → development (the .local suffix is stripped)', () => {
    expect(detectEnvironmentFromFilename('.env.local')).toEqual({
      detected: true,
      slug: 'development',
      confidence: 'high',
    });
  });

  test('.env.<name> → that slug (high confidence)', () => {
    expect(detectEnvironmentFromFilename('.env.production')).toEqual({
      detected: true,
      slug: 'production',
      confidence: 'high',
    });
    expect(detectEnvironmentFromFilename('.env.staging')).toEqual({
      detected: true,
      slug: 'staging',
      confidence: 'high',
    });
  });

  test('.env.<name>.local → that slug (strips .local, keeps confidence)', () => {
    expect(detectEnvironmentFromFilename('.env.production.local')).toEqual({
      detected: true,
      slug: 'production',
      confidence: 'high',
    });
  });

  test('directory components are stripped before parsing', () => {
    expect(detectEnvironmentFromFilename('apps/web/.env.production')).toEqual({
      detected: true,
      slug: 'production',
      confidence: 'high',
    });
  });

  test('<name>.env reversed form → low confidence', () => {
    expect(detectEnvironmentFromFilename('production.env')).toEqual({
      detected: true,
      slug: 'production',
      confidence: 'low',
    });
  });

  test('uppercase slugs are lowercased', () => {
    expect(detectEnvironmentFromFilename('.env.PRODUCTION')).toEqual({
      detected: true,
      slug: 'production',
      confidence: 'high',
    });
  });

  test('unrecognized patterns return detected: false', () => {
    expect(detectEnvironmentFromFilename('something.txt')).toEqual({ detected: false });
    expect(detectEnvironmentFromFilename('.env.')).toEqual({ detected: false });
    expect(detectEnvironmentFromFilename('config.json')).toEqual({ detected: false });
  });
});

describe('defaultFilenameForEnvironment', () => {
  test('development → .env (the bare-default case)', () => {
    expect(defaultFilenameForEnvironment('development')).toBe('.env');
  });

  test('other slugs → .env.<slug>', () => {
    expect(defaultFilenameForEnvironment('production')).toBe('.env.production');
    expect(defaultFilenameForEnvironment('staging')).toBe('.env.staging');
  });
});
