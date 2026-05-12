// Spawns the CLI as a subprocess against a mock server, with a sandboxed
// HOME directory so the test never touches the real OS keychain or
// ~/.config/envstore on disk.
//
// We invoke `bun run src/index.ts` instead of the compiled binary so tests
// run before the release build step in CI.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_ENTRY = resolve(import.meta.dir, '..', '..', 'src', 'index.ts');

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunOptions = {
  apiUrl: string;
  cwd: string;
  // Test identity (the age secret key); fed via ENVSTORE_IDENTITY so the CLI
  // never opens a keychain or reads a file from the runner's $HOME.
  identity: string;
  // Bearer token to authenticate API calls. Mock server accepts any value;
  // we pass a recognizable string for clarity.
  token?: string;
  // Extra env vars the test may want to inject.
  env?: Record<string, string>;
};

export async function runCli(args: string[], opts: RunOptions): Promise<RunResult> {
  const child = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      ENVSTORE_API_URL: opts.apiUrl,
      ENVSTORE_IDENTITY: opts.identity,
      ENVSTORE_TOKEN: opts.token ?? 'eswtok_TEST',
      // Force keychain off — `creds.ts` falls back to file storage, which
      // we redirect via XDG_CONFIG_HOME below.
      XDG_CONFIG_HOME: opts.cwd,
      HOME: opts.cwd,
      NO_COLOR: '1',
      ...(opts.env ?? {}),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const exitCode = await child.exited;
  return { exitCode, stdout, stderr };
}

export async function makeTempDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'envstore-test-'));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    },
  };
}
