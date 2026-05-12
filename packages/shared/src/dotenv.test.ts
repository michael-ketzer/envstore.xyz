import { describe, expect, test } from 'bun:test';

import {
  dotenvExample,
  dotenvKeys,
  dotenvLookup,
  dotenvSet,
  parseDotenv,
  serializeDotenv,
} from './dotenv';

describe('parseDotenv', () => {
  test('parses KEY=value lines', () => {
    const lines = parseDotenv('FOO=bar\nBAZ=qux\n');
    expect(lines).toEqual([
      { type: 'kv', key: 'FOO', value: 'bar', raw: 'FOO=bar' },
      { type: 'kv', key: 'BAZ', value: 'qux', raw: 'BAZ=qux' },
    ]);
  });

  test('preserves comments and blank lines', () => {
    const lines = parseDotenv('# header\n\nFOO=bar\n');
    expect(lines).toEqual([
      { type: 'comment', raw: '# header' },
      { type: 'blank' },
      { type: 'kv', key: 'FOO', value: 'bar', raw: 'FOO=bar' },
    ]);
  });

  test('handles double-quoted values with escapes', () => {
    const lines = parseDotenv('FOO="hello\\nworld"\n');
    expect(lines[0]).toMatchObject({ type: 'kv', key: 'FOO', value: 'hello\nworld' });
  });

  test('handles single-quoted values as literal', () => {
    const lines = parseDotenv("FOO='hello\\nworld'\n");
    expect(lines[0]).toMatchObject({ type: 'kv', key: 'FOO', value: 'hello\\nworld' });
  });

  test('strips inline # comments from unquoted values', () => {
    const lines = parseDotenv('FOO=bar # inline\n');
    expect(lines[0]).toMatchObject({ key: 'FOO', value: 'bar' });
  });

  test('keeps # inside quoted values', () => {
    const lines = parseDotenv('FOO="bar # not a comment"\n');
    expect(lines[0]).toMatchObject({ key: 'FOO', value: 'bar # not a comment' });
  });

  test('consumes the export prefix', () => {
    const lines = parseDotenv('export FOO=bar\n');
    expect(lines[0]).toMatchObject({ type: 'kv', key: 'FOO', value: 'bar' });
  });

  test('preserves malformed lines as comments so round-trip is stable', () => {
    const lines = parseDotenv('not valid\n=missing-key\n');
    expect(lines[0]).toEqual({ type: 'comment', raw: 'not valid' });
    expect(lines[1]).toEqual({ type: 'comment', raw: '=missing-key' });
  });

  test('handles CRLF line endings', () => {
    const lines = parseDotenv('FOO=bar\r\nBAZ=qux\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ key: 'FOO', value: 'bar' });
  });

  test('handles input without trailing newline', () => {
    const lines = parseDotenv('FOO=bar');
    expect(lines).toEqual([{ type: 'kv', key: 'FOO', value: 'bar', raw: 'FOO=bar' }]);
  });

  test('handles empty input', () => {
    expect(parseDotenv('')).toEqual([]);
  });
});

describe('serializeDotenv', () => {
  test('round-trips a typical .env file unchanged', () => {
    const original = '# comment\n\nFOO=bar\nBAZ=qux\n';
    expect(serializeDotenv(parseDotenv(original))).toBe(original);
  });

  test('quotes values with whitespace', () => {
    const out = serializeDotenv([{ type: 'kv', key: 'FOO', value: 'hello world', raw: 'unused' }]);
    expect(out).toBe('FOO="hello world"\n');
  });

  test('quotes values with hash characters', () => {
    const out = serializeDotenv([{ type: 'kv', key: 'FOO', value: 'a#b', raw: 'unused' }]);
    expect(out).toBe('FOO="a#b"\n');
  });

  test('escapes backslash, quote, and newline inside double-quoted values', () => {
    const out = serializeDotenv([{ type: 'kv', key: 'FOO', value: 'a\\b"c\nd', raw: 'unused' }]);
    expect(out).toBe('FOO="a\\\\b\\"c\\nd"\n');
  });

  test('quotes empty values', () => {
    const out = serializeDotenv([{ type: 'kv', key: 'FOO', value: '', raw: 'unused' }]);
    expect(out).toBe('FOO=""\n');
  });
});

describe('dotenvKeys / dotenvLookup', () => {
  test('keys returns dedupe-preserving-order', () => {
    const lines = parseDotenv('A=1\nB=2\nA=3\n');
    expect(dotenvKeys(lines)).toEqual(['A', 'B']);
  });

  test('lookup returns last-defined value', () => {
    const lines = parseDotenv('A=1\nA=2\n');
    expect(dotenvLookup(lines, 'A')).toBe('2');
  });

  test('lookup returns undefined for missing key', () => {
    expect(dotenvLookup(parseDotenv('A=1\n'), 'B')).toBeUndefined();
  });
});

describe('dotenvSet', () => {
  test('replaces an existing key in place', () => {
    const lines = parseDotenv('A=1\nB=2\n');
    const out = serializeDotenv(dotenvSet(lines, 'A', 'updated'));
    expect(out).toBe('A=updated\nB=2\n');
  });

  test('appends a new key when missing', () => {
    const lines = parseDotenv('A=1\n');
    const out = serializeDotenv(dotenvSet(lines, 'NEW', 'value'));
    expect(out).toBe('A=1\nNEW=value\n');
  });

  test('preserves comments when replacing', () => {
    const lines = parseDotenv('# header\nA=1\n# trailer\n');
    const out = serializeDotenv(dotenvSet(lines, 'A', '2'));
    expect(out).toBe('# header\nA=2\n# trailer\n');
  });

  test('drops duplicate definitions when replacing', () => {
    const lines = parseDotenv('A=1\nA=2\nA=3\n');
    const out = serializeDotenv(dotenvSet(lines, 'A', 'final'));
    expect(out).toBe('A=final\n');
  });

  test('quotes a value with whitespace on insert', () => {
    const out = serializeDotenv(dotenvSet([], 'A', 'hello world'));
    expect(out).toBe('A="hello world"\n');
  });

  test('rejects invalid env var names', () => {
    expect(() => dotenvSet([], '1FOO', 'x')).toThrow(/Invalid env var name/);
    expect(() => dotenvSet([], 'FOO-BAR', 'x')).toThrow(/Invalid env var name/);
    expect(() => dotenvSet([], '', 'x')).toThrow(/Invalid env var name/);
  });
});

describe('dotenvExample', () => {
  test('emits keys with empty values, preserves comments and blanks', () => {
    const input = '# Stripe\nSTRIPE_KEY=sk_test_xxx\n\nDATABASE_URL=postgres://x\n';
    expect(dotenvExample(parseDotenv(input))).toBe('# Stripe\nSTRIPE_KEY=\n\nDATABASE_URL=\n');
  });

  test('dedupes repeated keys', () => {
    const input = 'A=1\nA=2\nB=3\n';
    expect(dotenvExample(parseDotenv(input))).toBe('A=\nB=\n');
  });

  test('handles empty input', () => {
    expect(dotenvExample([])).toBe('\n');
  });
});
