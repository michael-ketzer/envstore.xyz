import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { makeEnvMock } from '@/test/env-mock';
import { makeR2Mock } from '@/test/r2-mock';

const config = {
  AUTH_SECRET: 'server-only-auth-secret-not-held-by-host',
  OPENBAO_BACKUP_TOKEN: 'test-backup-token' as string | undefined,
  MANAGED_KEYS_TRUST_PROXY: false,
};
const upload = mock();
const download = mock();
const head = mock();
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@/env', () => makeEnvMock({ env: config }));
mock.module('@/lib/r2', () =>
  makeR2Mock({ presignManagedKeyBackup: upload, presignGet: download, headObject: head }),
);
const { POST } = await import('./route');
const sizeBytes = 123;
const sha256Hex = 'a'.repeat(64);
function req(
  body: unknown,
  token: string | null = config.OPENBAO_BACKUP_TOKEN!,
  url = 'https://envstore.test/api/internal/managed-keys/backups',
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
function ticket(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${createHmac('sha256', config.AUTH_SECRET).update('envstore-openbao-backup-ticket-v1\0').update(payload).digest('base64url')}`;
}
beforeEach(() => {
  config.OPENBAO_BACKUP_TOKEN = 'test-backup-token';
  config.MANAGED_KEYS_TRUST_PROXY = false;
  upload
    .mockReset()
    .mockResolvedValue({ url: 'https://storage.test/upload', requiredHeaders: {}, expiresIn: 300 });
  download.mockReset().mockResolvedValue({ url: 'https://storage.test/download', expiresIn: 300 });
  head.mockReset().mockResolvedValue({ contentLength: sizeBytes });
});
describe('encrypted managed-key backup broker', () => {
  test('requires configured credential, authentication and HTTPS', async () => {
    const body = { operation: 'prepare', sizeBytes, sha256Hex };
    expect((await POST(req(body, null))).status).toBe(401);
    expect((await POST(req(body, 'wrong'))).status).toBe(401);
    expect(
      (await POST(req(body, config.OPENBAO_BACKUP_TOKEN, 'http://envstore.test'))).status,
    ).toBe(400);
    config.OPENBAO_BACKUP_TOKEN = undefined;
    expect((await POST(req(body, 'test-backup-token'))).status).toBe(503);
    expect(upload).not.toHaveBeenCalled();
  });
  test('generates an isolated object path and verifies only its signed ticket', async () => {
    const prepared = await POST(req({ operation: 'prepare', sizeBytes, sha256Hex }));
    expect(prepared.status).toBe(200);
    expect(prepared.headers.get('cache-control')).toBe('no-store');
    const body = await prepared.json();
    expect(body.key).toMatch(
      /^managed-key-backups\/media-server\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.tar\.age$/,
    );
    const verified = await POST(req({ operation: 'verify', ticket: body.ticket }));
    expect(verified.status).toBe(200);
    expect(head).toHaveBeenCalledWith(body.key);
    expect(download).toHaveBeenCalledWith(body.key, { expiresIn: 300 });
    expect((await verified.json()).sha256Hex).toBe(sha256Hex);
  });
  test('rejects arbitrary keys, excessive sizes and malformed digests', async () => {
    for (const body of [
      { operation: 'prepare', sizeBytes, sha256Hex, key: 'workspaces/secret' },
      { operation: 'prepare', sizeBytes: 128 * 1024 * 1024 + 1, sha256Hex },
      { operation: 'prepare', sizeBytes: 0, sha256Hex },
      { operation: 'prepare', sizeBytes, sha256Hex: 'invalid' },
    ])
      expect((await POST(req(body))).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
  test('rejects tampered, expired, malformed and out-of-prefix tickets', async () => {
    const payload = {
      key: `managed-key-backups/media-server/2026-09-26/${'a'.repeat(36)}.tar.age`,
      sizeBytes,
      sha256Hex,
      expires: Date.now() + 60000,
    };
    for (const value of [
      ticket(payload) + 'x',
      'bad',
      ticket({ ...payload, expires: 1 }),
      ticket({ ...payload, key: 'workspaces/secret' }),
    ]) {
      const response = await POST(req({ operation: 'verify', ticket: value }));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(head).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  test('refuses incomplete or differently sized uploads', async () => {
    const prepared = await (await POST(req({ operation: 'prepare', sizeBytes, sha256Hex }))).json();
    for (const value of [null, { contentLength: sizeBytes + 1 }]) {
      head.mockResolvedValueOnce(value);
      expect((await POST(req({ operation: 'verify', ticket: prepared.ticket }))).status).toBe(409);
    }
    expect(download).not.toHaveBeenCalled();
  });
  test('the upload bearer cannot forge tickets to historical backups', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        key: `managed-key-backups/media-server/2020-01-01/${'a'.repeat(36)}.tar.age`,
        sizeBytes,
        sha256Hex,
        expires: Date.now() + 60000,
      }),
    ).toString('base64url');
    for (const prefix of ['', 'envstore-openbao-backup-ticket-v1\0']) {
      const signature = createHmac('sha256', config.OPENBAO_BACKUP_TOKEN!)
        .update(prefix)
        .update(payload)
        .digest('base64url');
      expect(
        (await POST(req({ operation: 'verify', ticket: `${payload}.${signature}` }))).status,
      ).toBe(400);
    }
    expect(head).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  test('does not expose storage errors or presigned URLs on failure', async () => {
    upload.mockRejectedValueOnce(new Error('sensitive presigned URL'));
    const response = await POST(req({ operation: 'prepare', sizeBytes, sha256Hex }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sensitive');
  });
});
