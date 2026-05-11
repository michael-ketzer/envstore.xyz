// age-based encryption / decryption.
// IMPORTANT: this module is for the CLI and any CLI-bundled tooling ONLY.
// It must NEVER be imported by the web app — the web is metadata-only.
//
// To enforce this we also export a marker constant that build tooling / lint
// rules can check, and we keep the file in a separate subpath export.

import * as age from 'age-encryption';

export const AGE_BUNDLE_MARKER = '__envstore_age_only__' as const;

export type AgeIdentity = string; // "AGE-SECRET-KEY-1..." in canonical bech32 form
export type AgeRecipient = string; // "age1..." or "ssh-ed25519 ..." / "ssh-rsa ..."

export async function generateIdentity(): Promise<{
  identity: AgeIdentity;
  recipient: AgeRecipient;
}> {
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  return { identity, recipient };
}

export async function encryptForRecipients(
  plaintext: Uint8Array | string,
  recipients: readonly AgeRecipient[],
): Promise<Uint8Array> {
  if (recipients.length === 0) {
    throw new Error('Refusing to encrypt with zero recipients — nobody would be able to decrypt.');
  }
  const e = new age.Encrypter();
  for (const r of recipients) e.addRecipient(r);
  const data = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  return e.encrypt(data);
}

export async function decryptWithIdentity(
  ciphertext: Uint8Array,
  identity: AgeIdentity,
): Promise<Uint8Array> {
  const d = new age.Decrypter();
  d.addIdentity(identity);
  return d.decrypt(ciphertext);
}

export async function decryptToString(
  ciphertext: Uint8Array,
  identity: AgeIdentity,
): Promise<string> {
  const out = await decryptWithIdentity(ciphertext, identity);
  return new TextDecoder().decode(out);
}
