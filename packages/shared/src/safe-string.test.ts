// Tests for the safeDisplayString refinement — regression for H-1/H-2 in
// the May 2026 audit, where recipient labels / workspace names accepted
// ANSI escape sequences and NUL bytes.

import { describe, expect, test } from 'bun:test';

import { hasControlChars, safeDisplayString } from './safe-string';

describe('hasControlChars', () => {
  test.each([
    ['\x00 nul', true],
    ['\x07 bell', true],
    ['\x08 backspace', true],
    ['\x0a newline', true],
    ['\x1b ANSI escape', true],
    ['\x7f DEL', true],
    ['normal label', false],
    ['unicode é', false],
    ['emoji 🚀', false],
  ])('detects control char in %s', (input, expected) => {
    expect(hasControlChars(input)).toBe(expected);
  });
});

describe('safeDisplayString', () => {
  const schema = safeDisplayString(1, 60);

  test('accepts a normal label', () => {
    expect(schema.parse('MacBook Pro')).toBe('MacBook Pro');
  });

  test('trims surrounding whitespace', () => {
    expect(schema.parse('  trimmed  ')).toBe('trimmed');
  });

  test('rejects ANSI escape', () => {
    expect(() => schema.parse('\x1b[31mEVIL\x1b[0m')).toThrow(/control/);
  });

  test('rejects clear-line + carriage-return spoof', () => {
    expect(() => schema.parse('fake-label\x1b[2K\rREPLACED')).toThrow(/control/);
  });

  test('rejects NUL byte', () => {
    expect(() => schema.parse('before\x00after')).toThrow(/control/);
  });

  test('rejects backspace sequence', () => {
    expect(() => schema.parse('good-label\b\b\b\bEVIL')).toThrow(/control/);
  });

  test('rejects empty string after trim', () => {
    expect(() => schema.parse('   ')).toThrow();
  });
});
