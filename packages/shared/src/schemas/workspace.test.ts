// Unit tests for workspaceUpdateSchema's versionHistoryLimit field.
//
// Pinning the validation contract: workspace owners set this in the
// dashboard; the server-side action then trusts that the value falls
// inside the documented range without re-checking.

import { describe, expect, test } from 'bun:test';

import {
  VERSION_HISTORY_LIMIT_MAX,
  VERSION_HISTORY_LIMIT_MIN,
  workspaceUpdateSchema,
} from './workspace';

describe('workspaceUpdateSchema.versionHistoryLimit', () => {
  test('omitted → ok (partial update)', () => {
    const r = workspaceUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  test(`accepts the minimum (${VERSION_HISTORY_LIMIT_MIN})`, () => {
    const r = workspaceUpdateSchema.safeParse({
      versionHistoryLimit: VERSION_HISTORY_LIMIT_MIN,
    });
    expect(r.success).toBe(true);
  });

  test(`accepts the maximum (${VERSION_HISTORY_LIMIT_MAX})`, () => {
    const r = workspaceUpdateSchema.safeParse({
      versionHistoryLimit: VERSION_HISTORY_LIMIT_MAX,
    });
    expect(r.success).toBe(true);
  });

  test('accepts a typical middle value (50, the default)', () => {
    const r = workspaceUpdateSchema.safeParse({ versionHistoryLimit: 50 });
    expect(r.success).toBe(true);
  });

  test('rejects below the minimum', () => {
    const r = workspaceUpdateSchema.safeParse({
      versionHistoryLimit: VERSION_HISTORY_LIMIT_MIN - 1,
    });
    expect(r.success).toBe(false);
  });

  test('rejects 0 (degenerate — would purge everything)', () => {
    const r = workspaceUpdateSchema.safeParse({ versionHistoryLimit: 0 });
    expect(r.success).toBe(false);
  });

  test('rejects negative', () => {
    const r = workspaceUpdateSchema.safeParse({ versionHistoryLimit: -10 });
    expect(r.success).toBe(false);
  });

  test('rejects above the maximum', () => {
    const r = workspaceUpdateSchema.safeParse({
      versionHistoryLimit: VERSION_HISTORY_LIMIT_MAX + 1,
    });
    expect(r.success).toBe(false);
  });

  test('rejects a float (storage cap is integer)', () => {
    const r = workspaceUpdateSchema.safeParse({ versionHistoryLimit: 50.5 });
    expect(r.success).toBe(false);
  });

  test('rejects a string (no implicit coercion at the shared layer)', () => {
    const r = workspaceUpdateSchema.safeParse({ versionHistoryLimit: '50' });
    expect(r.success).toBe(false);
  });
});

describe('versionRollbackSchema invariants', () => {
  // Re-uses the shared schema; we re-import here so the test name reads
  // alongside its peer schemas.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { versionRollbackSchema } = require('./version') as typeof import('./version');

  test('versionId alone → ok', () => {
    expect(versionRollbackSchema.safeParse({ versionId: 'ver_1' }).success).toBe(true);
  });

  test('version (int) alone → ok', () => {
    expect(versionRollbackSchema.safeParse({ version: 1 }).success).toBe(true);
  });

  test('neither → fail (ambiguous what to roll back to)', () => {
    expect(versionRollbackSchema.safeParse({}).success).toBe(false);
  });

  test('both → fail (refuse ambiguous request)', () => {
    expect(
      versionRollbackSchema.safeParse({ versionId: 'ver_1', version: 1 }).success,
    ).toBe(false);
  });

  test('version: 0 → fail (non-positive)', () => {
    expect(versionRollbackSchema.safeParse({ version: 0 }).success).toBe(false);
  });

  test('version: -3 → fail', () => {
    expect(versionRollbackSchema.safeParse({ version: -3 }).success).toBe(false);
  });

  test('version: 1.5 → fail (not integer)', () => {
    expect(versionRollbackSchema.safeParse({ version: 1.5 }).success).toBe(false);
  });

  test('versionId: empty string → fail (min length)', () => {
    expect(versionRollbackSchema.safeParse({ versionId: '' }).success).toBe(false);
  });
});
