// Recipient parser tests — covers structural validation AND the new
// minimum-modulus-size rule for ssh-rsa (H-4 in the May 2026 audit).

import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';

import {
  InvalidRecipientError,
  MIN_SSH_RSA_BITS,
  parseRecipient,
  tryParseRecipient,
} from './recipients';

describe('parseRecipient', () => {
  test('accepts a well-formed age1 recipient', () => {
    const r = parseRecipient(
      'age1cpcjeqw924w6jfxxhkytgwk9v5faylezevdmhnn47pxck6hqqyqqpxptyp',
    );
    expect(r.kind).toBe('AGE_X25519');
  });

  test('rejects an age1 recipient with the wrong length', () => {
    expect(() => parseRecipient('age1tooshort')).toThrow(InvalidRecipientError);
  });

  test('accepts ssh-ed25519 with comment', () => {
    const r = parseRecipient('ssh-ed25519 AAAABBBB user@host');
    expect(r.kind).toBe('SSH_ED25519');
  });

  test('rejects unknown algorithm prefix', () => {
    expect(() => parseRecipient('ssh-dsa AAAA')).toThrow(InvalidRecipientError);
  });
});

describe('parseRecipient ssh-rsa size enforcement', () => {
  function rsaPubLine(bits: number): string {
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: bits,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    // Convert SPKI PEM → OpenSSH single-line. Node's exportSshPublicKey
    // would be simpler but isn't in the public API; instead, parse the
    // SPKI and rebuild the SSH-wire format.
    const der = Buffer.from(
      publicKey
        .replace(/-----BEGIN PUBLIC KEY-----/g, '')
        .replace(/-----END PUBLIC KEY-----/g, '')
        .replace(/\s+/g, ''),
      'base64',
    );
    // Crude SPKI walk: skip SEQUENCE + AlgorithmIdentifier and find the
    // BIT STRING containing the RSA pubkey, then parse modulus+exponent.
    let i = 0;
    function readLen(): number {
      const first = der[i++]!;
      if (first < 0x80) return first;
      const lenBytes = first & 0x7f;
      let n = 0;
      for (let j = 0; j < lenBytes; j++) n = (n << 8) | der[i++]!;
      return n;
    }
    if (der[i++] !== 0x30) throw new Error('SPKI: expected outer SEQUENCE');
    readLen();
    if (der[i++] !== 0x30) throw new Error('SPKI: expected algorithm SEQUENCE');
    const algLen = readLen();
    i += algLen;
    if (der[i++] !== 0x03) throw new Error('SPKI: expected BIT STRING');
    readLen();
    i += 1; // skip unused-bits byte
    if (der[i++] !== 0x30) throw new Error('SPKI: expected RSAPublicKey SEQUENCE');
    readLen();
    if (der[i++] !== 0x02) throw new Error('SPKI: expected modulus INTEGER');
    const modLen = readLen();
    const modulus = der.subarray(i, i + modLen);
    i += modLen;
    if (der[i++] !== 0x02) throw new Error('SPKI: expected exponent INTEGER');
    const expLen = readLen();
    const exponent = der.subarray(i, i + expLen);

    // SSH wire format: length-prefixed strings, MSB-first.
    function pack(value: Uint8Array): Buffer {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(value.length, 0);
      return Buffer.concat([len, value]);
    }
    const algName = Buffer.from('ssh-rsa');
    const body = Buffer.concat([pack(algName), pack(exponent), pack(modulus)]);
    return `ssh-rsa ${body.toString('base64')} test`;
  }

  test('rejects a 1024-bit ssh-rsa key', () => {
    const weak = rsaPubLine(1024);
    expect(() => parseRecipient(weak)).toThrow(/bits/);
    expect(tryParseRecipient(weak)).toBeNull();
  });

  test('accepts a 2048-bit ssh-rsa key (at the floor)', () => {
    const ok = rsaPubLine(MIN_SSH_RSA_BITS);
    const r = parseRecipient(ok);
    expect(r.kind).toBe('SSH_RSA');
  });

  test('accepts a 4096-bit ssh-rsa key (the recommended size)', () => {
    const ok = rsaPubLine(4096);
    const r = parseRecipient(ok);
    expect(r.kind).toBe('SSH_RSA');
  });

  test('rejects an ssh-rsa with a body that is not valid base64', () => {
    expect(() => parseRecipient('ssh-rsa !!!notbase64 test')).toThrow(InvalidRecipientError);
  });
});
