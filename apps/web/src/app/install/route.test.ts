// GET /install — the `curl | sh` installer endpoint.
//
// We pin the script's safety guarantees: response content-type so curl
// doesn't get HTML, repo URL is what we expect, and the script MUST
// perform a sha256 verification before placing anything on PATH.

import { describe, expect, mock, test } from 'bun:test';

mock.module('@/env.client', () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: 'https://envstore.xyz' },
}));

const { GET } = await import('./route');

describe('GET /install', () => {
  test('responds with shell-script content type (curl-safe)', () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/x-shellscript/);
    // x-source header makes the served script traceable to the deployment.
    expect(res.headers.get('x-source')).toBe('https://envstore.xyz/install');
  });

  test('cache header is short enough that releases propagate quickly', () => {
    const res = GET();
    const cc = res.headers.get('cache-control') ?? '';
    // 5 minutes — long enough to amortize installer hits, short enough that
    // a new release shows up within an iteration.
    expect(cc).toMatch(/max-age=300/);
  });

  test('script body contains the canonical repo URL and binary name', async () => {
    const body = await GET().text();
    expect(body).toContain('michael-ketzer/envstore.xyz');
    expect(body).toContain('BINARY="envstore"');
  });

  test('script verifies sha256 before placing the binary on PATH (security-critical)', async () => {
    const body = await GET().text();
    // The script must (a) download a .sha256 sidecar, (b) verify it, and
    // (c) refuse to install if neither sha256sum nor shasum is available.
    expect(body).toContain('.sha256');
    expect(body).toMatch(/sha256sum -c|shasum -a 256 -c/);
    expect(body).toMatch(/refusing to install without verification/);
    // mv → INSTALL_DIR must come AFTER the verification block.
    const verifyIdx = body.indexOf('verifying sha256 sidecar');
    const installIdx = body.indexOf('"$INSTALL_DIR/$BINARY"');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(verifyIdx);
  });

  test('script refuses unsupported OS / arch with non-zero exit', async () => {
    const body = await GET().text();
    expect(body).toContain('unsupported OS');
    expect(body).toContain('unsupported architecture');
  });

  test('script uses /usr/local/bin when writable, else ~/.local/bin with PATH hint', async () => {
    const body = await GET().text();
    expect(body).toContain('/usr/local/bin');
    expect(body).toContain('$HOME/.local/bin');
    expect(body).toContain('NEEDS_PATH_HINT');
  });
});
