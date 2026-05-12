// `envstore genexample` — derive .env.example from .env, locally.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeTempDir, runCli } from './helpers/cli';

let tmp: { path: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  tmp = await makeTempDir();
});

afterEach(async () => {
  await tmp.cleanup();
});

async function genexample(
  args: string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runCli(['genexample', ...args], {
    apiUrl: 'http://unused.test',
    cwd: tmp.path,
    identity: 'unused',
  });
}

describe('envstore genexample', () => {
  test('writes .env.example with empty values, preserving comments', async () => {
    await writeFile(
      join(tmp.path, '.env'),
      '# Stripe\nSTRIPE_KEY=sk_test_123\n\nDATABASE_URL=postgres://x\n',
    );

    const r = await genexample();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('.env.example');

    const out = await readFile(join(tmp.path, '.env.example'), 'utf8');
    expect(out).toBe('# Stripe\nSTRIPE_KEY=\n\nDATABASE_URL=\n');
  });

  test('refuses to overwrite without --force', async () => {
    await writeFile(join(tmp.path, '.env'), 'A=1\n');
    await writeFile(join(tmp.path, '.env.example'), 'PREVIOUS=\n');

    const r = await genexample();
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('already exists');

    // The previous file should be untouched.
    const out = await readFile(join(tmp.path, '.env.example'), 'utf8');
    expect(out).toBe('PREVIOUS=\n');
  });

  test('overwrites with --force', async () => {
    await writeFile(join(tmp.path, '.env'), 'A=1\nB=2\n');
    await writeFile(join(tmp.path, '.env.example'), 'STALE=\n');

    const r = await genexample(['--force']);
    expect(r.exitCode).toBe(0);

    const out = await readFile(join(tmp.path, '.env.example'), 'utf8');
    expect(out).toBe('A=\nB=\n');
  });

  test('--stdout prints to stdout and does not write a file', async () => {
    await writeFile(join(tmp.path, '.env'), 'TOKEN=abc\n');

    const r = await genexample(['--stdout']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('TOKEN=\n');

    // No file should have been written.
    await expect(readFile(join(tmp.path, '.env.example'), 'utf8')).rejects.toThrow();
  });

  test('handles a custom input path', async () => {
    await writeFile(join(tmp.path, '.env.production'), 'PROD=yes\n');

    const r = await genexample(['.env.production']);
    expect(r.exitCode).toBe(0);

    const out = await readFile(join(tmp.path, '.env.production.example'), 'utf8');
    expect(out).toBe('PROD=\n');
  });

  test('rejects binary input', async () => {
    // Plant a few NUL bytes so the text-check fires.
    await writeFile(join(tmp.path, '.env'), new Uint8Array([1, 2, 0, 3]));

    const r = await genexample();
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("doesn't look like text");
  });

  test('errors when .env is missing', async () => {
    const r = await genexample();
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('Cannot read');
  });
});
