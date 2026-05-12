// End-to-end push → pull integration test. This is the most important CLI
// test we have: it proves the real argv → command dispatch → HTTP → file I/O
// chain works, including the encryption round-trip across two independent CLI
// invocations.

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
  };
  server = await startMockServer({ workspaces: new Map([['acme', workspace]]) });
  tmp = await makeTempDir();
});

afterEach(async () => {
  await server.stop();
  await tmp.cleanup();
});

describe('envstore push + pull (single project, flat config)', () => {
  test('encrypts a .env, posts it, and finalizes — server stores ciphertext', async () => {
    const plaintext = 'STRIPE_KEY=sk_test_123\nDATABASE_URL=postgres://x\n';
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await writeFile(join(tmp.path, '.env'), plaintext);

    const r = await runCli(['push'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Pushed');

    // The server should have seen the init POST, the R2 PUT, and the finalize POST.
    const paths = server.requests.map((req) => `${req.method} ${req.path.split('?')[0]}`);
    expect(paths).toContain('GET /api/v1/workspaces/acme/recipients');
    expect(paths).toContain('POST /api/v1/workspaces/acme/projects/api/push');
    expect(
      paths.some((p) => p.startsWith('PUT /r2/v_api_development_1')),
    ).toBe(true);
    expect(
      paths.some((p) => p === 'POST /api/v1/workspaces/acme/projects/api/push/v_api_development_1/finalize'),
    ).toBe(true);

    // Ciphertext landed in our mock R2 and matches what the API was told to expect.
    const stored = server.state.workspaces
      .get('acme')!
      .projects.get('api')!
      .environments.get('development')![0]!;
    expect(stored.ciphertext.byteLength).toBeGreaterThan(plaintext.length);
    // Recipient-set hash on the version row should be a 64-char hex string.
    expect(stored.recipientsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('pull downloads the latest version and decrypts back to plaintext', async () => {
    // First push something, then nuke the local .env and pull it back.
    const plaintext = 'API_KEY=secret\nFLAG=on\n';
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await writeFile(join(tmp.path, '.env'), plaintext);

    const pushRes = await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(pushRes.exitCode).toBe(0);

    // Overwrite the local file so the pull has to produce it from ciphertext.
    await writeFile(join(tmp.path, '.env'), 'WILL_BE_REPLACED=yes\n');

    const pullRes = await runCli(['pull', '--force'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(pullRes.exitCode).toBe(0);
    const decrypted = await readFile(join(tmp.path, '.env'), 'utf8');
    expect(decrypted).toBe(plaintext);
  });

  test('pull fails cleanly when no local identity is available', async () => {
    // Push something first so there's a version to pull.
    await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON_DEV);
    await writeFile(join(tmp.path, '.env'), 'X=y\n');
    await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });

    // Then try pulling without ENVSTORE_IDENTITY set — should error before hitting the API.
    const r = await runCli(['pull'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity: '',
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('identity');
  });
});
