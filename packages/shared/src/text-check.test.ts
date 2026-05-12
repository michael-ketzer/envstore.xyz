import { describe, expect, test } from 'bun:test';

import { LIMITS } from './constants';
import { checkPlaintextSize, isText } from './text-check';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('isText', () => {
  test('plain ASCII text is accepted', () => {
    expect(isText(utf8('FOO=bar\nBAZ=qux\n'))).toEqual({ ok: true });
  });

  test('an empty buffer is accepted (nothing to fail on)', () => {
    expect(isText(new Uint8Array(0))).toEqual({ ok: true });
  });

  test('valid UTF-8 with multi-byte characters is accepted', () => {
    expect(isText(utf8('# 日本語コメント\nKEY=値'))).toEqual({ ok: true });
  });

  test('any NUL byte → has-null-byte (catches binary blobs early)', () => {
    const bytes = new Uint8Array([0x46, 0x4f, 0x4f, 0x00, 0x42, 0x41, 0x52]);
    expect(isText(bytes)).toEqual({ ok: false, reason: 'has-null-byte' });
  });

  test('invalid UTF-8 → invalid-utf8', () => {
    // 0x80 is a continuation byte with no leading byte — invalid.
    const bytes = new Uint8Array([0x80, 0x81, 0x82]);
    expect(isText(bytes)).toEqual({ ok: false, reason: 'invalid-utf8' });
  });

  test('only inspects the first textProbeBytes of large inputs', () => {
    // Valid utf-8 prefix, NUL well past the probe window — should still pass
    // because the heuristic intentionally samples and doesn't scan the whole file.
    const prefix = utf8('A'.repeat(LIMITS.textProbeBytes));
    const tail = new Uint8Array([0, 0, 0]);
    const buf = new Uint8Array(prefix.length + tail.length);
    buf.set(prefix, 0);
    buf.set(tail, prefix.length);
    expect(isText(buf)).toEqual({ ok: true });
  });
});

describe('checkPlaintextSize', () => {
  test('under the soft warning threshold → ok', () => {
    expect(checkPlaintextSize(1024)).toEqual({ level: 'ok' });
  });

  test('above the soft warning but under the hard cap → soft-warn', () => {
    const r = checkPlaintextSize(LIMITS.softPlaintextWarningBytes + 1);
    expect(r.level).toBe('soft-warn');
  });

  test('above the hard cap → too-large', () => {
    const r = checkPlaintextSize(LIMITS.maxPlaintextBytes + 1);
    expect(r.level).toBe('too-large');
  });
});
