// GET /install — the `curl | sh` installer endpoint.
//
// We pin the script's safety guarantees: response content-type so curl
// doesn't get HTML, repo URL is what we expect, and the script MUST
// perform a sha256 verification before placing anything on PATH. We also
// verify the two RELEASE_SIGNING_PUBKEY states — unset (skip minisign,
// keep current behavior) and set (require .minisig verification before
// install).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@/env.client', () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: 'https://envstore.xyz' },
}));

const { GET } = await import('./route');

const ORIGINAL_PUBKEY = process.env.RELEASE_SIGNING_PUBKEY;
beforeEach(() => {
  // Default to "no pubkey configured" so each test opts in explicitly.
  delete process.env.RELEASE_SIGNING_PUBKEY;
});
afterEach(() => {
  if (ORIGINAL_PUBKEY === undefined) delete process.env.RELEASE_SIGNING_PUBKEY;
  else process.env.RELEASE_SIGNING_PUBKEY = ORIGINAL_PUBKEY;
});

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

  test('with no RELEASE_SIGNING_PUBKEY env var → minisign step compiles to a no-op (back-compat)', async () => {
    const body = await GET().text();
    // The shell `if [ -n "$PUBKEY" ]` block is still emitted, but PUBKEY is
    // empty, so the body of the check is skipped at runtime. Confirm by
    // pinning the assignment AND that the only block guarding minisign
    // requires the var to be non-empty.
    expect(body).toContain('PUBKEY=""');
    expect(body).toMatch(/if \[ -n "\$PUBKEY" \]/);
    // No mention of minisign-as-required outside the guarded block — the
    // help text should also be inside the conditional, so a stripped sh
    // run never surfaces it without the pubkey being set.
    const guardIdx = body.indexOf('if [ -n "$PUBKEY" ]');
    const helpIdx = body.indexOf('minisign is required to verify');
    expect(helpIdx).toBeGreaterThan(guardIdx);
  });

  test('with RELEASE_SIGNING_PUBKEY set → script enforces minisign verification (M2)', async () => {
    process.env.RELEASE_SIGNING_PUBKEY =
      'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3';
    const body = await GET().text();
    // The pubkey is interpolated verbatim into the shell PUBKEY assignment.
    expect(body).toContain(
      'PUBKEY="RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3"',
    );
    // Script downloads the .minisig sidecar AND invokes minisign for verify.
    expect(body).toContain('.minisig');
    expect(body).toMatch(/minisign -V -q -P "\$PUBKEY"/);
    // Missing minisign tool → install fails with a helpful error (never falls
    // back to "trust the binary without verification").
    expect(body).toMatch(/minisign is required to verify the release signature/);
    // The mv → INSTALL_DIR must come AFTER the minisign verification step.
    const sigIdx = body.indexOf('verifying minisign signature');
    const installIdx = body.lastIndexOf('"$INSTALL_DIR/$BINARY"');
    expect(sigIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(sigIdx);
  });

  test('RELEASE_SIGNING_PUBKEY is trimmed before being embedded (defensive)', async () => {
    process.env.RELEASE_SIGNING_PUBKEY = '\n  RW_pubkey_value  \n';
    const body = await GET().text();
    expect(body).toContain('PUBKEY="RW_pubkey_value"');
  });
});
