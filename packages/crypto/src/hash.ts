// Hashing helpers used by both server and CLI.
// Uses the WebCrypto API — available in Node 20+, Bun, and modern browsers.

const HEX = '0123456789abcdef';

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  // Copy into a fresh Uint8Array<ArrayBuffer> to bridge the
  // `Uint8Array<ArrayBufferLike>` vs `BufferSource` mismatch in newer DOM types.
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return bytesToHex(await sha256(data));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += HEX[b >> 4]! + HEX[b & 0xf]!;
  }
  return out;
}

// Returns `Uint8Array<ArrayBuffer>` (not `ArrayBufferLike`) so callers passing
// the result to Prisma's `Bytes` columns or `crypto.subtle.digest` don't have
// to widen-cast.
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Canonical hash of a recipient set. Used to detect "members changed since
// this version was encrypted" without revealing membership.
export async function recipientsHash(recipients: readonly string[]): Promise<Uint8Array> {
  const canonical = recipients
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .sort()
    .join('\n');
  return sha256(canonical);
}

export async function recipientsHashHex(recipients: readonly string[]): Promise<string> {
  return bytesToHex(await recipientsHash(recipients));
}
