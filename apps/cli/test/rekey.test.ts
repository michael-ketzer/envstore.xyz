// Integration test for `envstore rekey`. Verifies the "recipient set drifted"
// flow end-to-end: an env was encrypted to recipient set {A}, the workspace
// now has {A, B}, and rekey decrypts with A then re-encrypts to {A, B} so B
// can read what's already pushed.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  decryptToString,
  encryptForRecipients,
  generateIdentity,
} from '@envstore/crypto/age';
import { recipientsHashHex, sha256Hex } from '@envstore/crypto/hash';

import { makeTempDir, runCli } from './helpers/cli';
import {
  startMockServer,
  type MockServer,
  type ProjectFixture,
  type WorkspaceFixture,
} from './helpers/server';

let server: MockServer;
let tmp: { path: string; cleanup: () => Promise<void> };
let alice: Awaited<ReturnType<typeof generateIdentity>>;
let bob: Awaited<ReturnType<typeof generateIdentity>>;

beforeEach(async () => {
  alice = await generateIdentity();
  bob = await generateIdentity();
  tmp = await makeTempDir();
});

afterEach(async () => {
  await server.stop();
  await tmp.cleanup();
});

describe('envstore rekey', () => {
  test('re-encrypts a stale version so a new recipient can decrypt it', async () => {
    // Stage: production was encrypted to {alice} only. The workspace now
    // also has bob (e.g. he was just invited and registered an identity).
    const plaintext = 'SECRET=top\n';
    const oldCiphertext = await encryptForRecipients(plaintext, [alice.recipient]);
    const project: ProjectFixture = {
      slug: 'api',
      name: 'api',
      environments: new Map([
        [
          'production',
          [
            {
              versionId: 'v_seed_1',
              version: 1,
              environmentSlug: 'production',
              ciphertext: oldCiphertext,
              ciphertextSha256: await sha256Hex(oldCiphertext),
              recipientsHash: await recipientsHashHex([alice.recipient]),
            },
          ],
        ],
      ]),
    };
    const workspace: WorkspaceFixture = {
      slug: 'acme',
      type: 'TEAM',
      projects: new Map([['api', project]]),
      // Today's recipient set: alice AND bob. Rekey should detect the drift
      // (the v1 row was encrypted to alice only) and re-push.
      recipients: [alice.recipient, bob.recipient],
    };
    server = await startMockServer({ workspaces: new Map([['acme', workspace]]) });

    await writeFile(
      join(tmp.path, 'envstore.json'),
      JSON.stringify({ workspace: 'acme', project: 'api' }),
    );

    // Alice is the one who can decrypt the existing version — she runs rekey.
    const r = await runCli(['rekey'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity: alice.identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toMatch(/rekey(ed)?/);

    // A new version should have landed.
    const versions = server.state.workspaces.get('acme')!.projects.get('api')!.environments.get('production')!;
    expect(versions.length).toBe(2);
    const newVersion = versions[1]!;

    // The new version's recipientsHash should match the CURRENT (alice + bob) set.
    const expectedHash = await recipientsHashHex([alice.recipient, bob.recipient]);
    expect(newVersion.recipientsHash).toBe(expectedHash);

    // And — the punchline — bob's identity must now be able to decrypt the
    // freshly-pushed ciphertext. Before the rekey, he couldn't.
    const decrypted = await decryptToString(newVersion.ciphertext, bob.identity);
    expect(decrypted).toBe(plaintext);
  });

  test('skips envs whose recipientsHash already matches (no-op steady state)', async () => {
    // Both alice and bob were in the recipient set when the env was pushed —
    // rekey should detect the match and skip without re-pushing.
    const plaintext = 'NOTHING_TO_DO=here\n';
    const currentHash = await recipientsHashHex([alice.recipient, bob.recipient]);
    const ciphertext = await encryptForRecipients(plaintext, [
      alice.recipient,
      bob.recipient,
    ]);
    const project: ProjectFixture = {
      slug: 'api',
      name: 'api',
      environments: new Map([
        [
          'development',
          [
            {
              versionId: 'v_seed_1',
              version: 1,
              environmentSlug: 'development',
              ciphertext,
              ciphertextSha256: await sha256Hex(ciphertext),
              recipientsHash: currentHash,
            },
          ],
        ],
      ]),
    };
    const workspace: WorkspaceFixture = {
      slug: 'acme',
      type: 'TEAM',
      projects: new Map([['api', project]]),
      recipients: [alice.recipient, bob.recipient],
    };
    server = await startMockServer({ workspaces: new Map([['acme', workspace]]) });

    await writeFile(
      join(tmp.path, 'envstore.json'),
      JSON.stringify({ workspace: 'acme', project: 'api' }),
    );

    const r = await runCli(['rekey'], {
      apiUrl: server.url,
      cwd: tmp.path,
      identity: alice.identity,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toMatch(/already current|skip/);

    // No new version should have landed.
    const versions = server.state.workspaces.get('acme')!.projects.get('api')!.environments.get('development')!;
    expect(versions.length).toBe(1);
  });
});
