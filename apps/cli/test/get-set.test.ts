// `envstore get` / `envstore set` — per-variable round-trip against the mock
// server. These tests exercise the same encryption + push/pull paths as
// push-pull.test.ts, but through the per-key surface.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { encryptForRecipients, generateIdentity } from '@envstore/crypto/age';
import { recipientsHashHex, sha256Hex } from '@envstore/crypto/hash';

import { makeTempDir, runCli } from './helpers/cli';
import {
  startMockServer,
  type EnvVersionFixture,
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
  };
  server = await startMockServer({ workspaces: new Map([['acme', workspace]]) });
  tmp = await makeTempDir();
  await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
});

afterEach(async () => {
  await server.stop();
  await tmp.cleanup();
});

async function seedVersion(envSlug: string, plaintext: string): Promise<void> {
  const ciphertext = await encryptForRecipients(new TextEncoder().encode(plaintext), [recipient]);
  const ciphertextSha256 = await sha256Hex(ciphertext);
  const recipientsHash = await recipientsHashHex([recipient]);
  const project = server.state.workspaces.get('acme')!.projects.get('api')!;
  const versions = project.environments.get(envSlug) ?? [];
  const versionNumber = (versions[versions.length - 1]?.version ?? 0) + 1;
  const fixture: EnvVersionFixture = {
    versionId: `v_api_${envSlug}_${versionNumber}`,
    version: versionNumber,
    environmentSlug: envSlug,
    ciphertext,
    ciphertextSha256,
    recipientsHash,
  };
  versions.push(fixture);
  project.environments.set(envSlug, versions);
}

async function latestPlaintext(envSlug: string): Promise<string> {
  const versions = server.state.workspaces
    .get('acme')!
    .projects.get('api')!
    .environments.get(envSlug)!;
  const latest = versions[versions.length - 1]!;
  // The mock server records ciphertext bytes as the CLI uploaded them; we
  // decrypt locally with the test identity to confirm what `set` actually wrote.
  const { decryptToString } = await import('@envstore/crypto/age');
  return decryptToString(latest.ciphertext, identity);
}

describe('envstore get', () => {
  test('prints the value of one key from the latest version', async () => {
    await seedVersion('development', 'STRIPE_KEY=sk_test_xxx\nDATABASE_URL=postgres://x\n');

    const r = await runCli(['get', 'STRIPE_KEY'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('sk_test_xxx');
  });

  test('--newline appends a trailing newline', async () => {
    await seedVersion('development', 'API_KEY=secret\n');

    const r = await runCli(['get', 'API_KEY', '--newline'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('secret\n');
  });

  test('exits with an error when the key is missing', async () => {
    await seedVersion('development', 'A=1\n');

    const r = await runCli(['get', 'MISSING'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('MISSING');
  });

  test('exits with an error when the env has no version yet', async () => {
    const r = await runCli(['get', 'A'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('No pushed version');
  });

  test('--env selects a different environment', async () => {
    await seedVersion('production', 'PROD_KEY=live_value\n');

    const r = await runCli(['get', 'PROD_KEY', '--env', 'production'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('live_value');
  });
});

describe('envstore set', () => {
  test('updates an existing key in place', async () => {
    await seedVersion('development', 'A=1\nB=old\nC=3\n');

    const r = await runCli(['set', 'B=new'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Set');

    const after = await latestPlaintext('development');
    expect(after).toBe('A=1\nB=new\nC=3\n');
  });

  test('appends a new key to an existing env', async () => {
    await seedVersion('development', 'A=1\n');

    const r = await runCli(['set', 'NEW=value'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);

    const after = await latestPlaintext('development');
    expect(after).toBe('A=1\nNEW=value\n');
  });

  test('seeds a fresh environment with no prior version', async () => {
    // No seedVersion call → the env has zero versions and pull will 404.
    const r = await runCli(['set', 'FIRST=hello'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Seeding fresh');

    const after = await latestPlaintext('development');
    expect(after).toBe('FIRST=hello\n');
  });

  test('--from-stdin keeps the value out of argv', async () => {
    await seedVersion('development', 'TOKEN=old\n');

    const cliEntry = new URL('../src/index.ts', import.meta.url).pathname;
    const proc = Bun.spawn(['bun', 'run', cliEntry, 'set', 'TOKEN', '--from-stdin'], {
      cwd: tmp.path,
      env: {
        ...process.env,
        ENVSTORE_API_URL: server.url,
        ENVSTORE_IDENTITY: identity,
        ENVSTORE_TOKEN: 'eswtok_TEST',
        XDG_CONFIG_HOME: tmp.path,
        HOME: tmp.path,
        NO_COLOR: '1',
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write('new-from-stdin');
    proc.stdin.end();
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code !== 0) throw new Error(`set --from-stdin failed: ${stderr}`);
    expect(stdout).toContain('Set');

    const after = await latestPlaintext('development');
    expect(after).toBe('TOKEN=new-from-stdin\n');
  });

  test('quotes values that contain spaces or special chars', async () => {
    await seedVersion('development', 'X=1\n');

    const r = await runCli(['set', 'GREETING=hello world'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);

    const after = await latestPlaintext('development');
    // serializer should have quoted "hello world".
    expect(after).toContain('GREETING="hello world"');
  });

  test('rejects malformed argv with a usage hint', async () => {
    const r = await runCli(['set', 'NOEQUALS'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('KEY=value');
  });
});
