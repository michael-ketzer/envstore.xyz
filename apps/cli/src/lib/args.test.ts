import { describe, expect, test } from 'bun:test';

import { parseArgs } from './args';

describe('parseArgs', () => {
  test('no args → empty positional + flags', () => {
    expect(parseArgs([])).toEqual({ positional: [], flags: {}, raw: [] });
  });

  test('plain positionals stay positional', () => {
    expect(parseArgs(['ls', 'projects', 'acme'])).toMatchObject({
      positional: ['ls', 'projects', 'acme'],
      flags: {},
    });
  });

  test('boolean flag (no value) → true', () => {
    expect(parseArgs(['push', '--force']).flags).toEqual({ force: true });
  });

  test('--flag=value form is parsed as a string value', () => {
    expect(parseArgs(['push', '--env=production']).flags).toEqual({
      env: 'production',
    });
  });

  test('--flag value (space-separated) is parsed when the flag is value-taking', () => {
    // `env` is in the NEEDS_VALUE set, so it consumes the next argv slot.
    expect(parseArgs(['push', '--env', 'production']).flags).toEqual({
      env: 'production',
    });
  });

  test('positional after a value-taking flag is NOT swallowed (regression)', () => {
    const out = parseArgs(['push', '--env', 'production', 'apps/web']);
    expect(out.flags).toEqual({ env: 'production' });
    expect(out.positional).toEqual(['push', 'apps/web']);
  });

  test('unknown flags without a value default to boolean true', () => {
    // `--unknown` is NOT in NEEDS_VALUE, so the following positional should
    // stay positional — not be consumed as the flag's value.
    const out = parseArgs(['push', '--unknown', 'apps/web']);
    expect(out.flags).toEqual({ unknown: true });
    expect(out.positional).toEqual(['push', 'apps/web']);
  });

  test('-- terminates flag parsing; everything after is positional', () => {
    const out = parseArgs(['push', '--', '--not-a-flag', 'literal']);
    expect(out.flags).toEqual({});
    expect(out.positional).toEqual(['push', '--not-a-flag', 'literal']);
  });

  test('short flags (-h, -v) become boolean true', () => {
    expect(parseArgs(['-v']).flags).toEqual({ v: true });
    expect(parseArgs(['-h']).flags).toEqual({ h: true });
  });

  test('raw[] preserves the input ordering for forwarding', () => {
    const out = parseArgs(['push', '--env', 'production', '--force']);
    expect(out.raw).toEqual(['push', '--env', 'production', '--force']);
  });
});
