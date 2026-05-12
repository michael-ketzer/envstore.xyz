import { describe, expect, test } from 'bun:test';

import {
  decryptToString,
  decryptWithIdentity,
  encryptForRecipients,
  generateIdentity,
} from './age';

describe('generateIdentity', () => {
  test('returns a bech32 secret key and a matching recipient', async () => {
    const { identity, recipient } = await generateIdentity();
    expect(identity).toMatch(/^AGE-SECRET-KEY-1/);
    expect(recipient).toMatch(/^age1/);
  });

  test('produces distinct keys on each call', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    expect(a.identity).not.toBe(b.identity);
    expect(a.recipient).not.toBe(b.recipient);
  });
});

describe('encryptForRecipients + decryptWithIdentity', () => {
  test('round-trips text encrypted to a single recipient', async () => {
    const { identity, recipient } = await generateIdentity();
    const plaintext = 'FOO=bar\nBAZ=qux\n';
    const ciphertext = await encryptForRecipients(plaintext, [recipient]);
    const decoded = await decryptToString(ciphertext, identity);
    expect(decoded).toBe(plaintext);
  });

  test('every named recipient can decrypt the same ciphertext (fan-out)', async () => {
    // This is the crucial property for the workspace recipient set: one push
    // produces ONE ciphertext that every member's identity can open.
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    const charlie = await generateIdentity();
    const plaintext = 'shared secret';
    const ciphertext = await encryptForRecipients(plaintext, [
      alice.recipient,
      bob.recipient,
      charlie.recipient,
    ]);
    expect(await decryptToString(ciphertext, alice.identity)).toBe(plaintext);
    expect(await decryptToString(ciphertext, bob.identity)).toBe(plaintext);
    expect(await decryptToString(ciphertext, charlie.identity)).toBe(plaintext);
  });

  test('an unlisted identity cannot decrypt', async () => {
    const alice = await generateIdentity();
    const eve = await generateIdentity();
    const ciphertext = await encryptForRecipients('top secret', [alice.recipient]);
    await expect(decryptWithIdentity(ciphertext, eve.identity)).rejects.toThrow();
  });

  test('refuses to encrypt with zero recipients (nobody could decrypt)', async () => {
    await expect(encryptForRecipients('anything', [])).rejects.toThrow();
  });

  test('accepts Uint8Array plaintext (the push code path)', async () => {
    const { identity, recipient } = await generateIdentity();
    const bytes = new TextEncoder().encode('binary-as-text\n');
    const ciphertext = await encryptForRecipients(bytes, [recipient]);
    const decrypted = await decryptWithIdentity(ciphertext, identity);
    expect(new TextDecoder().decode(decrypted)).toBe('binary-as-text\n');
  });
});
