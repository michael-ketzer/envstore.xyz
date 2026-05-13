// End-to-end tests for `envstore versions` and `envstore rollback`.
//
// These exercise the real argv → command dispatch → HTTP path against the
// mock server's new /environments/<env>/versions and /current handlers.
// The pull endpoint shares the "current pointer" resolution with the
// rollback handler, so we also assert that pull after rollback returns
// the chosen older version's ciphertext.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateIdentity } from '@envstore/crypto/age';

import { makeTempDir, runCli } from './helpers/cli';
import {
  startMockServer,
  type MockServer,
  type ProjectFixture,
  type WorkspaceFixture,
} from './helpers/server';

const ENVSTORE_JSON_DEV = JSON.stringify({
  workspace: 'acme',
  project: 'api',
  defaultEnv: 'development',
});

let server: MockServer;
let tmp: { path: string; cleanup: () => Promise<void> };
let identity: string;
let recipient: string;

beforeEach(async () => {
  const generated = await generateIdentity();
  identity = generated.identity;
  recipient = generated.recipient;

  const project: ProjectFixture = {
    slug: 'api',
    name: 'api',
    environments: new Map(),
  };
  const workspace: WorkspaceFixture = {
    slug: 'acme',
    type: 'TEAM',
    projects: new Map([['api', project]]),
    recipients: [recipient],
    versionHistoryLimit: 50,
  };
  server = await startMockServer({ workspaces: new Map([['acme', workspace]]) });
  tmp = await makeTempDir();
});

afterEach(async () => {
  await server.stop();
  await tmp.cleanup();
});

async function pushPlaintext(content: string): Promise<void> {
  await writeFile(join(tmp.path, '.env'), content);
  const r = await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });
  if (r.exitCode !== 0) {
    throw new Error(`push failed: ${r.stderr}`);
  }
}

describe('envstore versions', () => {
  test('no envstore.json → friendly error, exit code 1', async () => {
    const r = await runCli(['versions'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('No envstore.json');
  });

  test('empty environment → muted "no versions yet" message, exit 0', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    // Pre-seed an empty env so the list endpoint returns 200 with [].
    server.state.workspaces
      .get('acme')!
      .projects.get('api')!
      .environments.set('development', []);

    const r = await runCli(['versions'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('no versions yet');
  });

  test('lists versions newest-first with current marker and workspace cap', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await pushPlaintext('A=1\n');
    await pushPlaintext('A=2\n');
    await pushPlaintext('A=3\n');

    const r = await runCli(['versions'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('version history');
    expect(r.stdout).toContain('workspace cap: 50');
    // Newest first: v3 appears before v2 in the rendered output.
    const i3 = r.stdout.indexOf('v3');
    const i2 = r.stdout.indexOf('v2');
    const i1 = r.stdout.indexOf('v1');
    expect(i3).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i3);
    expect(i1).toBeGreaterThan(i2);
  });

  test('hits the right URL with env from positional arg', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    server.state.workspaces
      .get('acme')!
      .projects.get('api')!
      .environments.set('production', []);

    const r = await runCli(['versions', 'production'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    const versionsRequest = server.requests.find((req) =>
      req.path.startsWith('/api/v1/workspaces/acme/projects/api/environments/production/versions'),
    );
    expect(versionsRequest).toBeDefined();
    expect(versionsRequest!.method).toBe('GET');
  });

  test('rejects invalid env slug at the CLI before HTTP', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    const r = await runCli(['versions', 'Has Spaces'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('Invalid environment slug');
    const versionsRequest = server.requests.find((req) =>
      req.path.includes('/environments/'),
    );
    expect(versionsRequest).toBeUndefined();
  });
});

describe('envstore rollback', () => {
  test('refuses without a version arg', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    const r = await runCli(['rollback'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('Specify the version');
  });

  test('rejects non-numeric version', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    const r = await runCli(['rollback', 'abc', '--yes'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('not a valid version');
  });

  test('rejects zero and negative numbers', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    for (const arg of ['0', '-1']) {
      const r = await runCli(['rollback', arg, '--yes'], {
        apiUrl: server.url,
        cwd: tmp.path,
        identity,
      });
      expect(r.exitCode).not.toBe(0);
    }
  });

  test('rolls back happy path with --yes (non-interactive) and POSTs version int', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await pushPlaintext('A=1\n');
    await pushPlaintext('A=2\n');
    await pushPlaintext('A=3\n');

    const r = await runCli(['rollback', '2', '--yes'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Rolled');
    expect(r.stdout).toContain('v2');

    const rollbackReq = server.requests.find(
      (req) => req.method === 'POST' && req.path.endsWith('/development/current'),
    );
    expect(rollbackReq).toBeDefined();
    expect(rollbackReq!.body).toEqual({ version: 2 });
  });

  test('noop when target version is already current → exits 0 with friendly message', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await pushPlaintext('A=1\n');
    await pushPlaintext('A=2\n');

    // Latest is v2, which is current. Rolling forward to v2 is a no-op.
    const r = await runCli(['rollback', '2', '--yes'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('already the current version');
  });

  test('post-rollback pull returns the older version`s plaintext', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    const oldPlaintext = 'TOKEN=old_value\n';
    const newPlaintext = 'TOKEN=new_value\n';
    await pushPlaintext(oldPlaintext); // v1
    await pushPlaintext(newPlaintext); // v2 (current)

    // Roll back to v1.
    const rollbackRes = await runCli(['rollback', '1', '--yes'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(rollbackRes.exitCode).toBe(0);

    // Pull should now return v1's plaintext, NOT v2's.
    await writeFile(join(tmp.path, '.env'), 'placeholder\n'); // pre-existing, force overwrite
    const pullRes = await runCli(['pull', '--force'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(pullRes.exitCode).toBe(0);
    const restored = await readFile(join(tmp.path, '.env'), 'utf8');
    expect(restored).toBe(oldPlaintext);
  });

  test('--env routes to a different environment', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    // Seed a different env with a couple versions. We pass `--env
    // production` explicitly because the envstore.json sets defaultEnv,
    // which (by design) wins over filename auto-detection in push.
    await writeFile(join(tmp.path, '.env.production'), 'STAGE=prod\n');
    const push1 = await runCli(['push', '.env.production', '--env', 'production'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(push1.exitCode).toBe(0);
    await writeFile(join(tmp.path, '.env.production'), 'STAGE=prod2\n');
    const push2 = await runCli(['push', '.env.production', '--env', 'production'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(push2.exitCode).toBe(0);

    const r = await runCli(['rollback', '1', '--env', 'production', '--yes'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    const rollbackReq = server.requests.find(
      (req) => req.method === 'POST' && req.path.endsWith('/production/current'),
    );
    expect(rollbackReq).toBeDefined();
    expect(rollbackReq!.body).toEqual({ version: 1 });
  });

  test('--yes skips the interactive prompt even when stdin is a TTY (CI smoke)', async () => {
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await pushPlaintext('A=1\n');
    await pushPlaintext('A=2\n');

    // We can't easily simulate isTTY=true from Bun.spawn (pipes are
    // non-TTY by default), but `--yes` short-circuits the check
    // regardless. This test pins that behavior.
    const r = await runCli(['rollback', '1', '--yes'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('Proceed?');
  });
});
