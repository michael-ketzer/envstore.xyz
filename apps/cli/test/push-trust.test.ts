// Integration tests for the trust-on-first-use guard around `envstore push`.
//
// The unit tests in `src/lib/trust.test.ts` cover the pure diff/store/clear
// logic. These tests exercise the full subprocess CLI → mock server flow:
//   1. First push caches whatever the server returned (TOFU).
//   2. Subsequent push with an identical set is silent.
//   3. A newly-added recipient blocks the push in non-interactive mode.
//   4. `--trust-new` accepts the addition and updates the cache.
//   5. A pure removal (no additions) proceeds and shrinks the cache.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateIdentity } from '@envstore/crypto/age';

import { makeTempDir, runCli } from './helpers/cli';
import {
  startMockServer,
  type MockServer,
  type ProjectFixture,
  type WorkspaceFixture,
} from './helpers/server';

const ENVSTORE_JSON = JSON.stringify({
  workspace: 'acme',
  project: 'api',
  defaultEnv: 'development',
});

let server: MockServer;
let tmp: { path: string; cleanup: () => Promise<void> };
let identity: string;
let alice: string; // public recipient bound to `identity`
let bob: string; // a second public recipient — no private key needed locally,
//                  since encryption only consumes the public half

beforeEach(async () => {
  const aliceId = await generateIdentity();
  identity = aliceId.identity;
  alice = aliceId.recipient;
  bob = (await generateIdentity()).recipient;

  const project: ProjectFixture = {
    slug: 'api',
    name: 'api',
    environments: new Map(),
  };
  const workspace: WorkspaceFixture = {
    slug: 'acme',
    type: 'TEAM',
    projects: new Map([['api', project]]),
    recipients: [alice],
  };
  server = await startMockServer({ workspaces: new Map([['acme', workspace]]) });
  tmp = await makeTempDir();

  await writeFile(join(tmp.path, 'envstore.json'), ENVSTORE_JSON);
  await writeFile(join(tmp.path, '.env'), 'STRIPE_KEY=sk_test_x\n');
});

afterEach(async () => {
  await server.stop();
  await tmp.cleanup();
});

// Helper: read+parse the trust.json the CLI writes under XDG_CONFIG_HOME=tmp.
type TrustFileLite = {
  trust: Record<string, Record<string, Record<string, { recipients: string[] }>>>;
};
async function readTrustFile(): Promise<TrustFileLite | null> {
  try {
    return JSON.parse(await readFile(join(tmp.path, 'envstore', 'trust.json'), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// Helper: pre-seed a trust.json at the location the CLI will look at, so we
// can stage the "previous push trusted these recipients" precondition. The
// apiUrl key must match the runtime apiUrl (mock server origin) exactly.
async function seedTrust(recipients: string[]): Promise<void> {
  await mkdir(join(tmp.path, 'envstore'), { recursive: true });
  const file = {
    version: 1,
    trust: {
      [server.url]: {
        acme: {
          api: {
            recipients: [...recipients].sort(),
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    },
  };
  await writeFile(join(tmp.path, 'envstore', 'trust.json'), JSON.stringify(file, null, 2));
}

function recipientsAt(file: TrustFileLite): string[] {
  return file.trust[server.url]?.acme?.api?.recipients ?? [];
}

describe('envstore push — trust-on-first-use', () => {
  test('first contact caches the server recipient set', async () => {
    expect(await readTrustFile()).toBeNull();

    const r = await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).toBe(0);
    // The TOFU notice is informational; the push itself succeeds.
    expect(r.stdout + r.stderr).toMatch(/first push from this machine/i);

    const file = await readTrustFile();
    expect(file).not.toBeNull();
    expect(recipientsAt(file!)).toEqual([alice]);
  });

  test('exact match → silent push, cache unchanged', async () => {
    await seedTrust([alice]);

    const r = await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).toBe(0);
    // No "first push", no "new recipient", no "shrank" notices — the steady
    // state path is supposed to be quiet.
    const combined = (r.stdout + r.stderr).toLowerCase();
    expect(combined).not.toContain('first push');
    expect(combined).not.toContain('new recipient');
    expect(combined).not.toContain('shrank');

    const file = await readTrustFile();
    expect(recipientsAt(file!)).toEqual([alice]);
  });

  test('newly-added recipient blocks the push in non-interactive mode', async () => {
    // Server has decided to encrypt to alice + bob, but the local cache only
    // trusts alice. Without a TTY (subprocess context) and without
    // --trust-new, the CLI should refuse rather than encrypt to bob.
    server.state.workspaces.get('acme')!.recipients = [alice, bob];
    await seedTrust([alice]);

    const r = await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).not.toBe(0);
    const combined = (r.stdout + r.stderr).toLowerCase();
    expect(combined).toContain('--trust-new');

    // The cache must not have been updated — refusing the push leaves the
    // trusted set exactly as the user last authorized it.
    const file = await readTrustFile();
    expect(recipientsAt(file!)).toEqual([alice]);

    // And no push init / R2 PUT / finalize should have fired. The server
    // saw the /recipients GET (that's how we get the diff at all) but
    // nothing past it.
    const paths = server.requests.map((req) => `${req.method} ${req.path.split('?')[0]}`);
    expect(paths.some((p) => p.startsWith('POST /api/v1/workspaces/acme/projects/api/push'))).toBe(false);
  });

  test('--trust-new accepts the addition and updates the cache', async () => {
    server.state.workspaces.get('acme')!.recipients = [alice, bob];
    await seedTrust([alice]);

    const r = await runCli(['push', '--trust-new'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity,
    });
    expect(r.exitCode).toBe(0);
    // Should mention auto-acceptance so a CI log makes the policy decision
    // visible after the fact.
    expect((r.stdout + r.stderr).toLowerCase()).toContain('--trust-new');

    const file = await readTrustFile();
    expect(recipientsAt(file!).sort()).toEqual([alice, bob].sort());
  });

  test('removal-only diff proceeds without prompting and shrinks the cache', async () => {
    // Cache thinks alice + bob are trusted; server now reports only alice.
    // No "new recipient" → no prompt, even without --trust-new. The CLI
    // logs the removal and updates the cache.
    server.state.workspaces.get('acme')!.recipients = [alice];
    await seedTrust([alice, bob]);

    const r = await runCli(['push'], { apiUrl: server.url, cwd: tmp.path, identity });
    expect(r.exitCode).toBe(0);
    expect((r.stdout + r.stderr).toLowerCase()).toContain('shrank');

    const file = await readTrustFile();
    expect(recipientsAt(file!)).toEqual([alice]);
  });
});
