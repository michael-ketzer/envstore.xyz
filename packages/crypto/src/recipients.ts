// Recipient string parsing + structural validation.
// Web-safe: no encryption operations, no private keys, no age library dep.
// (Real cryptographic validation happens inside age when the CLI actually encrypts.)

import { detectRecipientKind, type RecipientKind } from '@envstore/shared';

export type ParsedRecipient = {
  raw: string;
  kind: RecipientKind;
};

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}

// age recipients look like: age1<58 chars of bech32>
const AGE_RECIPIENT_RE = /^age1[0-9a-z]{58}$/;
// ssh-ed25519 AAAA<base64>(...) [optional comment]
const SSH_ED25519_RE = /^ssh-ed25519\s+([A-Za-z0-9+/=]+)(\s+\S.*)?$/;
const SSH_RSA_RE = /^ssh-rsa\s+([A-Za-z0-9+/=]+)(\s+\S.*)?$/;

// Modern minimum for RSA. 1024-bit keys have been considered broken since
// 2010 and 512-bit keys are factorable in hours on commodity hardware —
// accepting them would let a malicious workspace admin register a weak
// recipient whose private key they can compute offline, defeating the
// zero-knowledge model.
export const MIN_SSH_RSA_BITS = 2048;

// Parse an SSH RSA public key's `n` (modulus) and return its bit length.
// SSH wire format (RFC 4253 §6.6): a string is a 32-bit big-endian length
// followed by that many bytes. The body of an ssh-rsa key is:
//   string "ssh-rsa"
//   mpint  e   (public exponent)
//   mpint  n   (modulus)
// mpint encoding adds a leading 0x00 byte when the high bit of the value
// would otherwise be 1 (to keep it non-negative); we strip that to get the
// actual modulus byte length.
function readSshString(buf: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (offset + 4 > buf.length) throw new Error('SSH wire format: truncated length prefix');
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  const len = view.getUint32(0, false);
  const start = offset + 4;
  if (start + len > buf.length) throw new Error('SSH wire format: truncated body');
  return { value: buf.subarray(start, start + len), next: start + len };
}

function sshRsaModulusBits(base64Body: string): number {
  const bin = atob(base64Body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const alg = readSshString(bytes, 0);
  const algName = new TextDecoder().decode(alg.value);
  if (algName !== 'ssh-rsa') {
    throw new InvalidRecipientError(`Unexpected SSH key algorithm "${algName}".`);
  }
  const e = readSshString(bytes, alg.next);
  const n = readSshString(bytes, e.next);
  // Strip the mpint leading-zero pad if present, then leading zero bytes,
  // then count bits in the most significant byte.
  let nBytes = n.value;
  while (nBytes.length > 0 && nBytes[0] === 0) nBytes = nBytes.subarray(1);
  if (nBytes.length === 0) return 0;
  const top = nBytes[0]!;
  let topBits = 0;
  for (let b = top; b > 0; b >>>= 1) topBits++;
  return (nBytes.length - 1) * 8 + topBits;
}

export function parseRecipient(input: string): ParsedRecipient {
  const trimmed = input.trim();
  const kind = detectRecipientKind(trimmed);
  if (!kind) {
    throw new InvalidRecipientError(
      'Recipient must start with "age1", "ssh-ed25519 ", or "ssh-rsa ".',
    );
  }
  if (kind === 'AGE_X25519' && !AGE_RECIPIENT_RE.test(trimmed)) {
    throw new InvalidRecipientError('Malformed age1 recipient.');
  }
  if (kind === 'SSH_ED25519' && !SSH_ED25519_RE.test(trimmed)) {
    throw new InvalidRecipientError('Malformed ssh-ed25519 public key.');
  }
  if (kind === 'SSH_RSA') {
    const m = SSH_RSA_RE.exec(trimmed);
    if (!m) {
      throw new InvalidRecipientError('Malformed ssh-rsa public key.');
    }
    // Reject weak modulus sizes. A teammate registering a 512-bit
    // ssh-rsa key as a workspace recipient could decrypt every push to
    // the workspace after factoring it offline.
    let bits: number;
    try {
      bits = sshRsaModulusBits(m[1]!);
    } catch (err) {
      throw new InvalidRecipientError(
        `ssh-rsa key has an unreadable body: ${(err as Error).message}`,
      );
    }
    if (bits < MIN_SSH_RSA_BITS) {
      throw new InvalidRecipientError(
        `ssh-rsa key is ${bits} bits — refusing keys smaller than ${MIN_SSH_RSA_BITS}. Generate a 4096-bit key with \`ssh-keygen -t rsa -b 4096\`, or use ssh-ed25519 / age instead.`,
      );
    }
  }
  return { raw: trimmed, kind };
}

export function tryParseRecipient(input: string): ParsedRecipient | null {
  try {
    return parseRecipient(input);
  } catch {
    return null;
  }
}

// Strip an optional trailing comment from an SSH key so display labels stay tidy.
export function shortenRecipient(recipient: string, maxChars = 28): string {
  const trimmed = recipient.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = trimmed.slice(0, maxChars - 3);
  return `${head}…`;
}
