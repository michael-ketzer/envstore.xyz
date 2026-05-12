import { describe, expect, test } from 'bun:test';

import { slugify, validateSlug, validateWorkspaceSlug } from './slug';

describe('validateSlug', () => {
  test('accepts a simple alphanumeric slug', () => {
    expect(validateSlug('api')).toEqual({ ok: true });
    expect(validateSlug('my-app')).toEqual({ ok: true });
    expect(validateSlug('a1b2')).toEqual({ ok: true });
  });

  test('rejects slugs that are too short', () => {
    const r = validateSlug('a');
    expect(r.ok).toBe(false);
  });

  test('rejects slugs that are too long', () => {
    const r = validateSlug('a'.repeat(100));
    expect(r.ok).toBe(false);
  });

  test('rejects uppercase, underscores, leading/trailing hyphens', () => {
    expect(validateSlug('My-App').ok).toBe(false);
    expect(validateSlug('my_app').ok).toBe(false);
    expect(validateSlug('-foo').ok).toBe(false);
    expect(validateSlug('foo-').ok).toBe(false);
    expect(validateSlug('foo--bar').ok).toBe(false);
  });

  test('honors a reserved set when provided', () => {
    const reserved = new Set(['admin']);
    expect(validateSlug('admin', { reserved }).ok).toBe(false);
    expect(validateSlug('admin-thing', { reserved }).ok).toBe(true);
  });
});

describe('validateWorkspaceSlug', () => {
  test('rejects the reserved "me" slug — collides with /dashboard/me', () => {
    const r = validateWorkspaceSlug('me');
    expect(r.ok).toBe(false);
  });
});

describe('slugify', () => {
  test('lowercases and replaces whitespace with single hyphens', () => {
    expect(slugify('My Workspace')).toBe('my-workspace');
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
  });

  test('strips diacritics', () => {
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('crème brûlée')).toBe('creme-brulee');
  });

  test('collapses non-alphanumerics into a single hyphen', () => {
    expect(slugify('foo!@#$bar')).toBe('foo-bar');
  });

  test('trims leading/trailing hyphens', () => {
    expect(slugify('!!!hello!!!')).toBe('hello');
  });

  test('returns empty string for input with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});
