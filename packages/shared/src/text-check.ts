// Text-vs-binary detection used by the CLI before encrypting a candidate file.
// Implements git's heuristic — sample the first N bytes, refuse on any NUL byte
// or invalid UTF-8. This catches every realistic non-text format (images,
// videos, executables, zips, sqlite, etc.) while accepting every realistic
// secret format (.env, PEM, JSON, SSH keys).
//
// The server cannot run this check — it never sees plaintext. This lives here
// so it's auditable in the open-source CLI and reusable in any future tooling.

import { LIMITS } from './constants';

export type TextCheckOk = { ok: true };
export type TextCheckErr = { ok: false; reason: 'has-null-byte' | 'invalid-utf8' };
export type TextCheckResult = TextCheckOk | TextCheckErr;

export function isText(data: Uint8Array): TextCheckResult {
  const sample = data.subarray(0, Math.min(data.length, LIMITS.textProbeBytes));

  // 1. Any NUL byte in the sample → binary.
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return { ok: false, reason: 'has-null-byte' };
  }

  // 2. Must be valid UTF-8. TextDecoder with `fatal: true` throws on invalid
  //    sequences; we treat that as binary.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
  } catch {
    return { ok: false, reason: 'invalid-utf8' };
  }

  return { ok: true };
}

export type PlaintextSizeCheck =
  | { level: 'ok' }
  | { level: 'soft-warn'; sizeBytes: number }
  | { level: 'too-large'; sizeBytes: number };

export function checkPlaintextSize(sizeBytes: number): PlaintextSizeCheck {
  if (sizeBytes > LIMITS.maxPlaintextBytes) return { level: 'too-large', sizeBytes };
  if (sizeBytes > LIMITS.softPlaintextWarningBytes) return { level: 'soft-warn', sizeBytes };
  return { level: 'ok' };
}
