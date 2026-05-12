import { describe, expect, test } from 'bun:test';

import { bytesToHex, hexToBytes, recipientsHashHex, sha256Hex } from './hash';

describe('sha256Hex', () => {
  test('matches the known empty-string digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('matches the known "abc" digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('Uint8Array and equivalent string produce the same hash', async () => {
    const fromString = await sha256Hex('hello');
    const fromBytes = await sha256Hex(new TextEncoder().encode('hello'));
    expect(fromString).toBe(fromBytes);
  });
});

describe('bytesToHex / hexToBytes', () => {
  test('round-trips arbitrary byte sequences', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('00010f107f80feff');
    expect(Array.from(hexToBytes(hex))).toEqual(Array.from(bytes));
  });

  test('hexToBytes rejects odd-length input', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
});

describe('recipientsHashHex', () => {
  test('is order-independent — same set, different input order = same hash', async () => {
    const a = await recipientsHashHex(['age1aaa', 'age1bbb', 'age1ccc']);
    const b = await recipientsHashHex(['age1ccc', 'age1aaa', 'age1bbb']);
    expect(a).toBe(b);
  });

  test('changes when membership changes (one added)', async () => {
    const a = await recipientsHashHex(['age1aaa', 'age1bbb']);
    const b = await recipientsHashHex(['age1aaa', 'age1bbb', 'age1ccc']);
    expect(a).not.toBe(b);
  });

  test('changes when membership changes (one removed)', async () => {
    const a = await recipientsHashHex(['age1aaa', 'age1bbb', 'age1ccc']);
    const b = await recipientsHashHex(['age1aaa', 'age1bbb']);
    expect(a).not.toBe(b);
  });

  test('ignores empty/whitespace entries and trims', async () => {
    const a = await recipientsHashHex(['age1aaa', 'age1bbb']);
    const b = await recipientsHashHex(['age1aaa', '', '  age1bbb  ', '']);
    expect(a).toBe(b);
  });

  test('empty set has a well-defined hash (equal to sha256 of empty string)', async () => {
    expect(await recipientsHashHex([])).toBe(await sha256Hex(''));
  });
});
