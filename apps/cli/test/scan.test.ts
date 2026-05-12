// `envstore scan` — flag plaintext .env files tracked in git.
//
// Each test spins up a tiny throwaway git repo in $TMPDIR, stages whatever
// the test cares about, and runs the CLI inside it. We never touch the real
// git config because Bun.spawn inherits HOME, which we point at the temp dir.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeTempDir, runCli } from './helpers/cli';

let tmp: { path: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  tmp = await makeTempDir();
  // `init.defaultBranch=main` keeps the test deterministic across git versions.
  await runGit(['init', '-q', '--initial-branch=main']);
  await runGit(['config', 'user.email', 'test@envstore.test']);
  await runGit(['config', 'user.name', 'envstore-test']);
});

afterEach(async () => {
  await tmp.cleanup();
});

async function runGit(args: string[]): Promise<void> {
  const proc = Bun.spawn(['git', ...args], { cwd: tmp.path });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

async function commit(message: string): Promise<void> {
  // Stage everything currently in the working tree, then commit. The harness
  // tests use this to create a "tracked" state for `envstore scan` to see.
  await runGit(['add', '-A']);
  await runGit(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
}

async function scan(
  args: string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runCli(['scan', ...args], {
    apiUrl: 'http://unused.test',
    cwd: tmp.path,
    identity: 'unused',
  });
}

describe('envstore scan', () => {
  test('passes on a clean repo with no .env files', async () => {
    await writeFile(join(tmp.path, 'README.md'), '# hello\n');
    await commit('init');

    const r = await scan();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No tracked .env files look unsafe');
  });

  test('passes when only .env.example is tracked', async () => {
    await writeFile(join(tmp.path, '.env.example'), 'DATABASE_URL=\n');
    await commit('add example');

    const r = await scan();
    expect(r.exitCode).toBe(0);
  });

  test('flags a tracked .env', async () => {
    await writeFile(join(tmp.path, '.env'), 'DATABASE_URL=secret\n');
    await commit('oops');

    const r = await scan();
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('.env');
    expect(r.stdout + r.stderr).toContain('git rm --cached');
  });

  test('flags .env.production but not .env.production.example', async () => {
    await writeFile(join(tmp.path, '.env.production'), 'STRIPE=sk_live\n');
    await writeFile(join(tmp.path, '.env.production.example'), 'STRIPE=\n');
    await commit('mix');

    const r = await scan();
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toContain('.env.production');
    // The example should NOT be listed as flagged.
    const flaggedSection = (r.stdout.match(/✗.+/g) ?? []).join('\n');
    expect(flaggedSection).not.toContain('.env.production.example');
  });

  test('--staged only checks the index, not previously committed files', async () => {
    // Already-committed .env — would be flagged by the default scan, but not
    // by --staged because nothing is currently being added.
    await writeFile(join(tmp.path, '.env'), 'X=1\n');
    await commit('historical');

    const r = await scan(['--staged']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No risky .env files staged');
  });

  test('--staged flags a newly-staged .env', async () => {
    await writeFile(join(tmp.path, 'README.md'), '# hello\n');
    await commit('init');
    // Stage a new .env without committing it.
    await writeFile(join(tmp.path, '.env'), 'API_KEY=hunter2\n');
    await runGit(['add', '.env']);

    const r = await scan(['--staged']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toContain('.env');
  });

  test('errors clearly when run outside a git repo', async () => {
    const noGit = await makeTempDir();
    try {
      const r = await runCli(['scan'], {
        apiUrl: 'http://unused.test',
        cwd: noGit.path,
        identity: 'unused',
      });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toLowerCase()).toContain('git');
    } finally {
      await noGit.cleanup();
    }
  });

  test('ignores .envrc (direnv config, not a secrets file)', async () => {
    await writeFile(join(tmp.path, '.envrc'), 'export PATH=$PATH:./bin\n');
    await commit('envrc');

    const r = await scan();
    expect(r.exitCode).toBe(0);
  });
});
