import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { FakePrismaKnownError, makeDbMock } from '@/test/db-mock';
import { makeEnvMock } from '@/test/env-mock';
import type { BindingContext } from './contracts';

const db = {
  managedKey: {
    findFirst: mock(),
    findMany: mock(),
    upsert: mock(),
    update: mock(),
    findUnique: mock(),
    count: mock(),
    updateMany: mock(),
  },
  managedKeyApplication: {
    findUnique: mock(),
    findFirst: mock(),
    findMany: mock(),
    create: mock(),
    update: mock(),
  },
  managedKeyCredential: {
    findUnique: mock(),
    findFirst: mock(),
    findMany: mock(),
    create: mock(),
    update: mock(),
  },
  managedKeyAuditEvent: { create: mock(), update: mock(), findFirst: mock(), findMany: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspace: { findFirst: mock() },
  workspaceMember: { findUnique: mock() },
  // Interactive transactions run against the same mocks; $executeRaw takes locks.
  $transaction: mock(),
  $executeRaw: mock(),
};
const config = {
  NODE_ENV: 'test',
  OPENBAO_URL: 'https://bao.test',
  OPENBAO_TRANSIT_MOUNT: 'transit',
  OPENBAO_RUNTIME_TOKEN: 'runtime-token',
  OPENBAO_ADMIN_TOKEN: 'admin-token',
  MANAGED_KEYS_TRUST_PROXY: false,
  NEXT_PUBLIC_APP_URL: 'https://envstore.test',
};
const flags = { managedKeys: true };
mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: db }));
mock.module('@/env', () => makeEnvMock({ env: config, features: flags }));
const { runtimeRequest, adminRequest } = await import('./service');
const engine = await import('./openbao');
const { readJson } = await import('./http');
const { POST: generateRoute } = await import('@/app/v1/keys/[keyId]/data-keys/route');
const { POST: unwrapRoute } = await import('@/app/api/v1/keys/[keyId]/data-keys/unwrap/route');
const { POST: appGenerateRoute } =
  await import('@/app/api/v1/workspaces/[workspaceSlug]/data-keys/route');
const { POST: appUnwrapRoute } =
  await import('@/app/api/v1/workspaces/[workspaceSlug]/data-keys/unwrap/route');
const keyId = '6fd445c3-a7b2-48ea-93da-644a4c4b96a1';
const credentialId = '9dbcb9e1-7458-48a7-9dcc-b610e7e9c8b8';
const token = `esmk_${'a'.repeat(43)}`;
const context = {
  purpose: 'shinra-creator-briefing-v1',
  teamId: 'team-1',
  campaignId: 'campaign-1',
  creatorId: 'creator-1',
  accessId: 'assignment-1',
};
const key = {
  id: keyId,
  workspaceId: 'ws-1',
  tenantId: 'team-1',
  environment: 'production',
  name: 'briefings',
  purpose: context.purpose,
  provisionedAt: new Date(),
  disabledAt: null,
};
const plaintext = Buffer.alloc(32, 7).toString('base64');
const ciphertext = 'vault:v1:YWJj';
const wrappedKey = `esmk1.openbao.${keyId}.${Buffer.from(ciphertext).toString('base64url')}`;
let credential: {
  id: string;
  workspaceId: string;
  tenantId: string;
  environment: string;
  revokedAt: Date | null;
  expiresAt: Date;
  workspace: { deletedAt: Date | null };
  grants: {
    keyId: string;
    operations: string[];
    key: Omit<typeof key, 'disabledAt' | 'provisionedAt'> & {
      disabledAt: Date | null;
      provisionedAt: Date | null;
    };
  }[];
};
let backend: ReturnType<typeof mock>;
const VERCEL_JWKS = 'https://oidc.vercel.com/.well-known/jwks';
const signing = await generateKeyPair('RS256');
const publicJwk = { ...(await exportJWK(signing.publicKey)), kid: 'vercel-key', alg: 'RS256' };
const nativeFetch = globalThis.fetch;

function req(
  body: unknown = { context },
  bearer = token,
  url = 'https://envstore.test/v1/keys',
  method = 'POST',
) {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
function adminReq(body: unknown = {}, url?: string, method = 'POST') {
  return req(body, 'human-token', url, method);
}
function response(data: unknown, status = 200) {
  return Response.json(data, { status });
}

beforeEach(() => {
  for (const model of Object.values(db)) {
    if (typeof model === 'function') model.mockReset();
    else for (const fn of Object.values(model)) fn.mockReset();
  }
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => unknown) => work(db));
  db.$executeRaw.mockResolvedValue(0);
  Object.assign(config, {
    OPENBAO_URL: 'https://bao.test',
    MANAGED_KEYS_TRUST_PROXY: false,
    NODE_ENV: 'test',
  });
  flags.managedKeys = true;
  credential = {
    id: credentialId,
    workspaceId: 'ws-1',
    tenantId: 'team-1',
    environment: 'production',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60000),
    workspace: { deletedAt: null },
    grants: [{ keyId, operations: ['generate', 'unwrap'], key: { ...key } }],
  };
  db.managedKeyCredential.findUnique.mockImplementation(async () => credential);
  db.managedKeyAuditEvent.create.mockResolvedValue({ id: 'audit-1' });
  db.managedKeyAuditEvent.update.mockResolvedValue({});
  db.cliToken.findUnique.mockResolvedValue({
    id: 'cli-1',
    userId: 'user-1',
    user: { id: 'user-1' },
  });
  db.cliToken.update.mockResolvedValue({});
  db.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
  db.workspaceMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
  db.managedKey.findFirst.mockResolvedValue({ ...key });
  db.managedKey.findMany.mockResolvedValue([{ ...key }]);
  db.managedKey.upsert.mockResolvedValue({ ...key, provisionedAt: null });
  db.managedKey.update.mockImplementation(async ({ data }: { data: Partial<typeof key> }) => ({
    ...key,
    ...data,
  }));
  db.managedKeyCredential.create.mockResolvedValue({ id: credentialId });
  backend = mock(async (url: URL | string) => {
    if (String(url) === VERCEL_JWKS) return response({ keys: [publicJwk] });
    const path = new URL(String(url)).pathname;
    if (path.includes('/datakey/')) return response({ data: { plaintext, ciphertext } });
    if (path.includes('/decrypt/')) return response({ data: { plaintext } });
    return response({
      data: {
        type: 'aes256-gcm96',
        derived: true,
        exportable: false,
        allow_plaintext_backup: false,
        deletion_allowed: false,
        latest_version: 2,
      },
    });
  });
  globalThis.fetch = backend as typeof fetch;
});

// Restore fetch even if another suite runs afterwards.
import { afterAll } from 'bun:test';
afterAll(() => {
  globalThis.fetch = nativeFetch;
});

describe('managed-key runtime', () => {
  test('routes generate and unwrap 256-bit keys, with explicit provider/version and no-store', async () => {
    const generated = await generateRoute(req(), { params: Promise.resolve({ keyId }) });
    expect(generated.status).toBe(200);
    expect(generated.headers.get('cache-control')).toBe('no-store');
    expect(await generated.json()).toEqual({
      provider: 'envstore-openbao-transit',
      version: 1,
      keyId,
      plaintextKey: plaintext,
      wrappedKey,
    });
    const unwrapped = await unwrapRoute(req({ context, wrappedKey }), {
      params: Promise.resolve({ keyId }),
    });
    expect((await unwrapped.json()).plaintextKey).toBe(plaintext);
    const options = backend.mock.calls[0]![1] as RequestInit;
    expect(options.cache).toBe('no-store');
    expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({ 'X-Vault-Token': 'runtime-token' });
    const payload = JSON.parse(options.body as string);
    expect(payload.bits).toBe(256);
    expect(Buffer.from(payload.context, 'base64').toString()).toContain('production');
    const audit = JSON.stringify([
      ...db.managedKeyAuditEvent.create.mock.calls,
      ...db.managedKeyAuditEvent.update.mock.calls,
    ]);
    expect(audit).toContain('data-key.generate');
    expect(audit).not.toContain(plaintext);
    expect(audit).not.toContain(wrappedKey);
    expect(audit).not.toContain(context.campaignId);
  });
  test.each(['human-token', 'eswtok_service', 'esmk_bad'])(
    'rejects other credential kinds: %s',
    async (bearer) => {
      const r = await runtimeRequest(req({ context }, bearer), keyId, 'generate');
      expect(r.status).toBe(401);
      expect(db.managedKeyCredential.findUnique).not.toHaveBeenCalled();
      expect(backend).not.toHaveBeenCalled();
      expect(r.headers.get('cache-control')).toBe('no-store');
    },
  );
  test.each([
    'revoked',
    'expired',
    'deleted-workspace',
    'disabled',
    'unprovisioned',
    'wrong-tenant',
    'wrong-environment',
    'wrong-workspace',
    'no-grants',
    'wrong-operation',
  ])('denies %s before contacting engine', async (scenario) => {
    if (scenario === 'revoked') credential.revokedAt = new Date();
    if (scenario === 'expired') credential.expiresAt = new Date(0);
    if (scenario === 'deleted-workspace') credential.workspace.deletedAt = new Date();
    if (scenario === 'disabled') credential.grants[0].key.disabledAt = new Date();
    if (scenario === 'unprovisioned') credential.grants[0].key.provisionedAt = null;
    if (scenario === 'wrong-tenant') credential.tenantId = 'team-2';
    if (scenario === 'wrong-environment') credential.environment = 'staging';
    if (scenario === 'wrong-workspace') credential.workspaceId = 'ws-2';
    if (scenario === 'no-grants') credential.grants = [];
    if (scenario === 'wrong-operation') credential.grants[0].operations = ['unwrap'];
    const r = await runtimeRequest(req(), keyId, 'generate');
    expect([401, 403]).toContain(r.status);
    expect(backend).not.toHaveBeenCalled();
  });
  test('denies mismatched tenant/purpose and unexpected content', async () => {
    for (const value of [
      { ...context, teamId: 'other-team' },
      { ...context, purpose: 'another-purpose' },
    ]) {
      expect((await runtimeRequest(req({ context: value }), keyId, 'generate')).status).toBe(403);
    }
    for (const body of [
      { context, briefing: 'secret body' },
      { context: { ...context, name: 'Name' } },
      { context: { ...context, assignmentId: 'both' } },
      { context: { ...context, accessId: undefined } },
    ]) {
      expect((await runtimeRequest(req(body), keyId, 'generate')).status).toBe(400);
    }
    expect(backend).not.toHaveBeenCalled();
  });
  test('accepts assignmentId as its own exact binding', async () => {
    const { accessId, ...rest } = context;
    expect(
      (
        await runtimeRequest(
          req({ context: { ...rest, assignmentId: accessId } }),
          keyId,
          'generate',
        )
      ).status,
    ).toBe(200);
  });
  test('requires HTTPS and explicit proxy trust; service is opt-in', async () => {
    const insecure = req({ context }, token, 'http://envstore.test');
    insecure.headers.set('x-forwarded-proto', 'https');
    expect((await runtimeRequest(insecure, keyId, 'generate')).status).toBe(400);
    config.MANAGED_KEYS_TRUST_PROXY = true;
    expect((await runtimeRequest(insecure, keyId, 'generate')).status).toBe(200);
    flags.managedKeys = false;
    expect((await runtimeRequest(req(), keyId, 'generate')).status).toBe(400);
    config.MANAGED_KEYS_TRUST_PROXY = false;
    expect((await runtimeRequest(req(), keyId, 'generate')).status).toBe(503);
  });
  test('rechecks revocation before releasing plaintext', async () => {
    backend.mockImplementation(async () => {
      credential.revokedAt = new Date();
      return response({ data: { plaintext, ciphertext } });
    });
    const r = await runtimeRequest(req(), keyId, 'generate');
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(plaintext);
  });
  test('fails closed if audit storage fails before or after the engine call', async () => {
    db.managedKeyAuditEvent.create.mockRejectedValueOnce(new Error('database details'));
    expect((await runtimeRequest(req(), keyId, 'generate')).status).toBe(503);
    expect(backend).not.toHaveBeenCalled();
    db.managedKeyAuditEvent.update.mockRejectedValue(new Error('audit failed'));
    const r = await runtimeRequest(req(), keyId, 'generate');
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain(plaintext);
  });
});

describe('OpenBao boundary', () => {
  test('canonicalizes context order and keeps every binding field', async () => {
    await engine.generateDataKey(key, context);
    await engine.generateDataKey(
      key,
      Object.fromEntries(Object.entries(context).reverse()) as BindingContext,
    );
    const payloads = backend.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(payloads[0].context).toBe(payloads[1].context);
    for (const field of ['campaignId', 'creatorId', 'accessId']) {
      await engine.generateDataKey(key, { ...context, [field]: 'different' });
      expect(JSON.parse(backend.mock.calls.at(-1)![1].body).context).not.toBe(payloads[0].context);
    }
  });
  test.each([
    'aws-wrapped-key',
    wrappedKey.replace('esmk1', 'esmk2'),
    wrappedKey.replace(keyId, credentialId),
    wrappedKey + '=',
  ])('rejects wrong provider, version, key, or noncanonical encoding', async (wrapped) => {
    const r = await runtimeRequest(req({ context, wrappedKey: wrapped }), keyId, 'unwrap');
    expect(r.status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  test.each([400, 403, 500])('sanitizes backend failure %s', async (status) => {
    backend.mockResolvedValue(response({ error: `sensitive ${plaintext}` }, status));
    const r = await runtimeRequest(req({ context, wrappedKey }), keyId, 'unwrap');
    expect(r.status).toBe(status === 400 ? 400 : 503);
    expect(await r.text()).not.toContain(plaintext);
  });
  test('rejects malformed/oversized key responses, exceptions and non-HTTPS engines', async () => {
    for (const data of [
      { plaintext: 'short', ciphertext },
      { plaintext, ciphertext: 'unexpected' },
      { plaintext, ciphertext, padding: 'x'.repeat(17000) },
    ]) {
      backend.mockResolvedValue(response({ data }));
      expect((await runtimeRequest(req(), keyId, 'generate')).status).toBe(503);
    }
    backend.mockRejectedValue(new Error(`request failed ${plaintext}`));
    expect(await (await runtimeRequest(req(), keyId, 'generate')).text()).not.toContain(plaintext);
    backend.mockClear();
    config.OPENBAO_URL = 'http://remote.test';
    expect((await runtimeRequest(req(), keyId, 'generate')).status).toBe(503);
    expect(backend).not.toHaveBeenCalled();
  });
  test('bounds chunked requests and idle streams', async () => {
    const huge = req({ context, padding: 'x'.repeat(17000) });
    expect((await runtimeRequest(huge, keyId, 'generate')).status).toBe(413);
    await expect(readJson(new ReadableStream({ start() {} }), 16, 10)).rejects.toMatchObject({
      status: 408,
    });
    const malformed = new Request('https://envstore.test', {
      method: 'POST',
      body: 'no JSON',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    expect((await runtimeRequest(malformed, keyId, 'generate')).status).toBe(400);
  });
});

describe('administration', () => {
  test('runtime credentials and non-admin members cannot administer', async () => {
    expect((await adminRequest(req(), 'workspace', 'credential.issue')).status).toBe(403);
    expect(db.cliToken.findUnique).not.toHaveBeenCalled();
    db.workspaceMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    expect((await adminRequest(adminReq(), 'workspace', 'key.list')).status).toBe(403);
    expect(backend).not.toHaveBeenCalled();
  });
  test('provisions idempotently and rejects a changed purpose or disabled key', async () => {
    const input = {
      name: key.name,
      tenantId: key.tenantId,
      environment: key.environment,
      purpose: key.purpose,
    };
    expect((await adminRequest(adminReq(input), 'workspace', 'key.provision')).status).toBe(200);
    expect(backend.mock.calls[0]![1].headers).toMatchObject({ 'X-Vault-Token': 'admin-token' });
    expect(db.managedKeyAuditEvent.update.mock.calls[0]![0].data).toMatchObject({ keyId });
    db.managedKey.upsert.mockResolvedValue(key);
    backend.mockClear();
    expect((await adminRequest(adminReq(input), 'workspace', 'key.provision')).status).toBe(200);
    expect(backend.mock.calls).toHaveLength(1);
    expect(backend.mock.calls[0]![1].method).toBe('GET');
    expect(
      (await adminRequest(adminReq({ ...input, purpose: 'changed' }), 'workspace', 'key.provision'))
        .status,
    ).toBe(409);
    db.managedKey.upsert.mockResolvedValue({ ...key, disabledAt: new Date() });
    expect((await adminRequest(adminReq(input), 'workspace', 'key.provision')).status).toBe(409);
  });
  test('requires explicit scoped grants and stores only credential hashes', async () => {
    const input = {
      applicationId: 'shinra',
      tenantId: key.tenantId,
      environment: key.environment,
      grants: [{ keyId, operations: ['generate', 'unwrap'] }],
    };
    const r = await adminRequest(adminReq(input), 'workspace', 'credential.issue');
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json();
    const saved = db.managedKeyCredential.create.mock.calls[0]![0].data;
    expect(saved.tokenHash).toBe(createHash('sha256').update(body.token).digest('hex'));
    expect(JSON.stringify(saved)).not.toContain(body.token);
    expect(db.managedKey.findMany.mock.calls[0]![0].where).toMatchObject({
      tenantId: key.tenantId,
      environment: key.environment,
      workspaceId: key.workspaceId,
    });
    expect(
      (await adminRequest(adminReq({ ...input, grants: [] }), 'workspace', 'credential.issue'))
        .status,
    ).toBe(400);
    db.managedKey.findMany.mockResolvedValue([]);
    expect((await adminRequest(adminReq(input), 'workspace', 'credential.issue')).status).toBe(400);
  });
  test('cross-workspace mutations are scoped and disabling never deletes engine keys', async () => {
    expect((await adminRequest(adminReq(), 'workspace', 'key.disable', keyId)).status).toBe(200);
    expect(backend).not.toHaveBeenCalled();
    expect(db.managedKey.findFirst.mock.calls[0]![0].where).toEqual({
      id: keyId,
      workspaceId: 'ws-1',
    });
    db.managedKey.findFirst.mockResolvedValue(null);
    expect((await adminRequest(adminReq(), 'workspace', 'key.rotate', keyId)).status).toBe(404);
  });
  test('revocation is idempotent and audit pages are bounded/workspace-scoped', async () => {
    db.managedKeyCredential.findFirst.mockResolvedValue({
      id: credentialId,
      revokedAt: new Date(0),
    });
    expect(
      (await adminRequest(adminReq(), 'workspace', 'credential.revoke', credentialId)).status,
    ).toBe(200);
    expect(db.managedKeyCredential.update.mock.calls[0]![0].data.revokedAt).toEqual(new Date(0));
    db.managedKeyAuditEvent.findMany.mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    const r = await adminRequest(
      adminReq({}, 'https://envstore.test/audit?limit=1', 'GET'),
      'workspace',
      'audit.list',
    );
    expect(await r.json()).toEqual({ events: [{ id: 'one' }], nextCursor: 'one' });
    expect(db.managedKeyAuditEvent.findMany.mock.calls[0]![0].where).toEqual({
      workspaceId: 'ws-1',
    });
    expect(
      (
        await adminRequest(
          adminReq({}, 'https://envstore.test/audit?limit=10000', 'GET'),
          'workspace',
          'audit.list',
        )
      ).status,
    ).toBe(400);
  });
});

describe('applications', () => {
  const applicationId = 'c3f7a1a2-8f55-4f0e-9a51-2f7f5d1f0a11';
  const appToken = `esma_${'b'.repeat(43)}`;
  const identity = { owner_id: 'team_abc', project_id: 'prj_def', environment: 'production' };
  let application: Record<string, unknown> & {
    workspace: { slug: string; deletedAt: Date | null };
  };
  let stored: typeof key & { disabledAt: Date | null; provisionedAt: Date | null };

  async function vercelToken(
    claims: Record<string, unknown> = {},
    {
      iss = 'https://oidc.vercel.com/acme',
      aud = 'https://envstore.test',
      ttl = '2h',
      iat = undefined as number | undefined,
    } = {},
    signer: CryptoKey = signing.privateKey,
  ) {
    return new SignJWT({ ...identity, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'vercel-key' })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt(iat)
      .setExpirationTime(ttl)
      .sign(signer);
  }
  function appReq(bearer: string, body: unknown = { context }, workspace = 'workspace') {
    return [
      req(body, bearer, `https://envstore.test/api/v1/workspaces/${workspace}/data-keys`),
      { params: Promise.resolve({ workspaceSlug: workspace }) },
    ] as const;
  }
  const unwrapBody = { context, keyId, wrappedKey };

  beforeEach(() => {
    application = {
      id: applicationId,
      workspaceId: 'ws-1',
      name: 'shinra-production',
      environment: 'production',
      purpose: context.purpose,
      keyName: 'briefings',
      maxTenants: 10,
      vercelTeamId: 'team_abc',
      vercelProjectId: 'prj_def',
      vercelEnvironment: 'production',
      tokenHash: null,
      expiresAt: null,
      revokedAt: null,
      workspace: { slug: 'workspace', deletedAt: null },
    };
    stored = { ...key };
    db.managedKeyApplication.findMany.mockImplementation(async () => [application]);
    db.managedKeyApplication.findUnique.mockImplementation(async () => application);
    db.managedKey.findUnique.mockImplementation(async () => stored);
    db.managedKey.findFirst.mockImplementation(async () => stored);
    db.managedKey.count.mockResolvedValue(0);
    db.managedKey.updateMany.mockResolvedValue({ count: 1 });
  });

  // First in this block: jose caches Vercel's key set after a successful download.
  test('reports an unavailable Vercel key set as an outage, not a bad token', async () => {
    backend.mockImplementation(async () => response({ error: 'down' }, 500));
    const r = await appGenerateRoute(...appReq(await vercelToken()));
    expect(r.status).toBe(503);
  });

  test('a Vercel deployment generates and unwraps keys for its registered purpose', async () => {
    const token = await vercelToken();
    const generated = await appGenerateRoute(...appReq(token));
    expect(generated.status).toBe(200);
    expect(await generated.json()).toEqual({
      provider: 'envstore-openbao-transit',
      version: 1,
      keyId,
      plaintextKey: plaintext,
      wrappedKey,
    });
    const lookup = db.managedKeyApplication.findMany.mock.calls[0]![0];
    expect(lookup.where).toMatchObject({
      workspace: { slug: 'workspace' },
      vercelTeamId: 'team_abc',
      vercelProjectId: 'prj_def',
      vercelEnvironment: 'production',
      purpose: context.purpose,
      revokedAt: null,
    });
    const unwrapped = await appUnwrapRoute(...appReq(token, unwrapBody));
    expect(unwrapped.status).toBe(200);
    expect((await unwrapped.json()).plaintextKey).toBe(plaintext);
    const audit = JSON.stringify([
      ...db.managedKeyAuditEvent.create.mock.calls,
      ...db.managedKeyAuditEvent.update.mock.calls,
    ]);
    expect(audit).toContain(applicationId);
    expect(audit).not.toContain(plaintext);
    expect(audit).not.toContain(token);
    expect(audit).not.toContain(context.campaignId);
  });

  test('creates a tenant key on first use with the fixed engine settings', async () => {
    db.managedKey.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...key, provisionedAt: new Date() })
      .mockImplementation(async () => stored);
    db.managedKey.upsert.mockResolvedValue({ ...key, provisionedAt: null });
    const r = await appGenerateRoute(...appReq(await vercelToken()));
    expect(r.status).toBe(200);
    // Counting and creation happen under a lock for this key space.
    expect(db.$executeRaw.mock.calls[0]!.slice(1)).toEqual([
      'managed-key-tenants:ws-1:production:briefings',
    ]);
    expect(db.managedKey.upsert.mock.calls[0]![0]).toMatchObject({
      where: {
        workspaceId_tenantId_environment_name: {
          workspaceId: 'ws-1',
          tenantId: context.teamId,
          environment: 'production',
          name: 'briefings',
        },
      },
      create: { purpose: context.purpose },
      update: {},
    });
    const creation = backend.mock.calls.find(([url]) =>
      String(url).endsWith(`/keys/envstore-${keyId}`),
    );
    expect(creation![1].headers).toMatchObject({ 'X-Vault-Token': 'admin-token' });
    expect(JSON.parse(creation![1].body)).toMatchObject({ derived: true, exportable: false });
    expect(db.managedKey.updateMany.mock.calls[0]![0].where).toEqual({
      id: keyId,
      provisionedAt: null,
    });
    const operations = db.managedKeyAuditEvent.create.mock.calls.map((c) => c[0].data.operation);
    expect(operations).toEqual(['data-key.generate', 'key.provision']);
  });

  test('a concurrent first use is settled under the lock', async () => {
    db.managedKey.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...key })
      .mockImplementation(async () => stored);
    expect((await appGenerateRoute(...appReq(await vercelToken()))).status).toBe(200);
    expect(db.managedKey.count).not.toHaveBeenCalled();
    expect(db.managedKey.upsert).not.toHaveBeenCalled();
  });

  test('never creates keys past the tenant limit or over another purpose, disabled key', async () => {
    db.managedKey.findUnique.mockResolvedValue(null);
    db.managedKey.count.mockResolvedValue(10);
    expect((await appGenerateRoute(...appReq(await vercelToken()))).status).toBe(403);
    expect(db.managedKey.upsert).not.toHaveBeenCalled();
    for (const existing of [
      { ...key, purpose: 'another-purpose', provisionedAt: null },
      { ...key, disabledAt: new Date(), provisionedAt: null },
    ]) {
      db.managedKey.findUnique.mockResolvedValue(existing);
      expect((await appGenerateRoute(...appReq(await vercelToken()))).status).toBe(403);
    }
    expect(backend).not.toHaveBeenCalled();
  });

  test.each([
    ['another audience', {}, { aud: 'https://vercel.com/acme' }],
    ['another issuer', {}, { iss: 'https://evil.example' }],
    ['an issuer path', {}, { iss: 'https://oidc.vercel.com/acme/extra' }],
    ['an expired token', {}, { ttl: '-1m' }],
    ['a token older than 12 hours', {}, { iat: Math.floor(Date.now() / 1000) - 13 * 3600 }],
    ['a malformed team', { owner_id: 'acme' }, {}],
  ])('rejects %s', async (_, claims, options) => {
    const r = await appGenerateRoute(...appReq(await vercelToken(claims, options)));
    expect(r.status).toBe(401);
    expect(db.managedKeyApplication.findMany).not.toHaveBeenCalled();
    expect(backend.mock.calls.every(([url]) => String(url) === VERCEL_JWKS)).toBe(true);
  });

  test('rejects forged, symmetric, and unsigned tokens', async () => {
    const forger = await generateKeyPair('RS256');
    const forged = await vercelToken({}, {}, forger.privateKey);
    const symmetric = await new SignJWT(identity)
      .setProtectedHeader({ alg: 'HS256', kid: 'vercel-key' })
      .setIssuer('https://oidc.vercel.com')
      .setAudience('https://envstore.test')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(identity)).toString('base64url')}.`;
    for (const token of [forged, symmetric, unsigned]) {
      expect((await appGenerateRoute(...appReq(token))).status).toBe(401);
    }
    expect(db.managedKeyApplication.findMany).not.toHaveBeenCalled();
  });

  test('binds workspace, project, environment, purpose, and tenant', async () => {
    db.managedKeyApplication.findMany.mockResolvedValue([]);
    expect((await appGenerateRoute(...appReq(await vercelToken()))).status).toBe(403);
    db.managedKeyApplication.findMany.mockResolvedValue([application, application]);
    expect((await appGenerateRoute(...appReq(await vercelToken()))).status).toBe(403);
    db.managedKeyApplication.findMany.mockImplementation(async () => [application]);
    const token = await vercelToken();
    for (const other of [
      { tenantId: 'team-2' },
      { environment: 'staging' },
      { name: 'other-keys' },
      { workspaceId: 'ws-2' },
      { purpose: 'another-purpose' },
    ]) {
      stored = { ...key, ...other };
      expect((await appUnwrapRoute(...appReq(token, unwrapBody))).status).toBe(403);
    }
    stored = { ...key };
    const body = { ...unwrapBody, context: { ...context, teamId: 'team-2' } };
    expect((await appUnwrapRoute(...appReq(token, body))).status).toBe(403);
    expect(db.managedKey.findFirst.mock.calls[0]![0].where).toEqual({
      id: keyId,
      workspaceId: 'ws-1',
    });
    for (const bad of [
      { context },
      { ...unwrapBody, keyId: 'not-a-uuid' },
      { ...unwrapBody, x: 1 },
    ]) {
      expect((await appUnwrapRoute(...appReq(token, bad))).status).toBe(400);
    }
    expect(backend.mock.calls.every(([url]) => String(url) === VERCEL_JWKS)).toBe(true);
  });

  test('rechecks revocation before releasing plaintext', async () => {
    const token = await vercelToken();
    backend.mockImplementation(async (url: URL | string) => {
      if (String(url) === VERCEL_JWKS) return response({ keys: [publicJwk] });
      application.revokedAt = new Date();
      return response({ data: { plaintext, ciphertext } });
    });
    const r = await appGenerateRoute(...appReq(token));
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(plaintext);
  });

  test('static application tokens: hashed lookup, expiry, workspace and purpose', async () => {
    application = {
      ...application,
      vercelTeamId: null,
      vercelProjectId: null,
      vercelEnvironment: null,
      tokenHash: createHash('sha256').update(appToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60000),
    };
    expect((await appGenerateRoute(...appReq(appToken))).status).toBe(200);
    expect(db.managedKeyApplication.findUnique.mock.calls[0]![0].where).toEqual({
      tokenHash: application.tokenHash,
    });
    expect((await appGenerateRoute(...appReq(appToken, { context }, 'elsewhere'))).status).toBe(
      403,
    );
    const other = { context: { ...context, purpose: 'another-purpose' } };
    expect((await appGenerateRoute(...appReq(appToken, other))).status).toBe(403);
    application.expiresAt = new Date(0);
    expect((await appGenerateRoute(...appReq(appToken))).status).toBe(401);
    db.managedKeyApplication.findUnique.mockResolvedValue(null);
    for (const bearer of [appToken, token, 'esma_short', 'human-token']) {
      expect((await appGenerateRoute(...appReq(bearer))).status).toBe(401);
    }
  });

  test('registers Vercel deployments idempotently and static tokens once', async () => {
    const vercel = { teamId: 'team_abc', projectId: 'prj_def', environment: 'production' };
    const input = {
      name: 'shinra-production',
      environment: 'production',
      purpose: context.purpose,
      keyName: 'briefings',
      vercel,
    };
    const url = 'https://envstore.test/api/v1/workspaces/workspace/managed-keys/applications';
    db.managedKeyApplication.findUnique.mockResolvedValue(null);
    db.managedKeyApplication.findFirst.mockResolvedValue(null);
    db.managedKeyApplication.create.mockImplementation(async ({ data }) => ({
      id: applicationId,
      ...data,
    }));
    const created = await adminRequest(adminReq(input, url), 'workspace', 'application.register');
    expect(created.status).toBe(201);
    expect(db.managedKeyApplication.create.mock.calls[0]![0].data).toMatchObject({
      workspaceId: 'ws-1',
      createdByUserId: 'user-1',
      maxTenants: 1000,
      vercelTeamId: 'team_abc',
      vercelProjectId: 'prj_def',
      vercelEnvironment: 'production',
    });
    expect((await created.json()).token).toBeUndefined();
    db.managedKeyApplication.findUnique.mockResolvedValue({ ...application, maxTenants: 1000 });
    expect(
      (await adminRequest(adminReq(input, url), 'workspace', 'application.register')).status,
    ).toBe(200);
    expect(db.managedKeyApplication.create).toHaveBeenCalledTimes(1);
    db.managedKeyApplication.update.mockResolvedValue(application);
    const raised = { ...input, maxTenants: 5000 };
    expect(
      (await adminRequest(adminReq(raised, url), 'workspace', 'application.register')).status,
    ).toBe(200);
    expect(db.managedKeyApplication.update.mock.calls[0]![0].data).toEqual({ maxTenants: 5000 });
    const moved = { ...input, vercel: { ...vercel, environment: 'preview' } };
    expect(
      (await adminRequest(adminReq(moved, url), 'workspace', 'application.register')).status,
    ).toBe(409);
    db.managedKeyApplication.findUnique.mockResolvedValue(null);
    db.managedKeyApplication.findFirst.mockResolvedValue({ id: 'other' });
    const renamed = { ...input, name: 'another-name' };
    expect(
      (await adminRequest(adminReq(renamed, url), 'workspace', 'application.register')).status,
    ).toBe(409);
    // The deployment check runs under a lock for that identity.
    expect(db.$executeRaw.mock.calls.at(-1)!.slice(1)).toEqual([
      `managed-key-application:ws-1:${context.purpose}:team_abc:prj_def:production`,
    ]);
    db.managedKeyApplication.findFirst.mockResolvedValue(null);
    // A concurrent registration that took the name first is a conflict too.
    db.managedKeyApplication.create.mockRejectedValueOnce(new FakePrismaKnownError('P2002'));
    expect(
      (await adminRequest(adminReq(renamed, url), 'workspace', 'application.register')).status,
    ).toBe(409);
    const { vercel: _, ...tokenInput } = { ...input, token: { expiresInDays: 30 } };
    const issued = await adminRequest(
      adminReq(tokenInput, url),
      'workspace',
      'application.register',
    );
    expect(issued.status).toBe(201);
    const secret = (await issued.json()).token;
    expect(secret).toMatch(/^esma_[A-Za-z0-9_-]{43}$/);
    const saved = db.managedKeyApplication.create.mock.calls.at(-1)![0].data;
    expect(saved.tokenHash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(JSON.stringify(saved)).not.toContain(secret);
    for (const bad of [
      { ...input, token: { expiresInDays: 30 } },
      { ...input, vercel: undefined },
      { ...input, vercel: { ...vercel, teamId: 'acme' } },
      { ...input, maxTenants: 0 },
    ]) {
      expect(
        (await adminRequest(adminReq(bad, url), 'workspace', 'application.register')).status,
      ).toBe(400);
    }
  });

  test('revocation is scoped and idempotent; application tokens cannot administer', async () => {
    db.managedKeyApplication.findFirst.mockResolvedValue({
      id: applicationId,
      revokedAt: new Date(0),
    });
    expect(
      (await adminRequest(adminReq(), 'workspace', 'application.revoke', applicationId)).status,
    ).toBe(200);
    expect(db.managedKeyApplication.findFirst.mock.calls[0]![0].where).toEqual({
      id: applicationId,
      workspaceId: 'ws-1',
    });
    expect(db.managedKeyApplication.update.mock.calls[0]![0].data.revokedAt).toEqual(new Date(0));
    db.managedKeyApplication.findFirst.mockResolvedValue(null);
    expect(
      (await adminRequest(adminReq(), 'workspace', 'application.revoke', applicationId)).status,
    ).toBe(404);
    expect((await adminRequest(adminReq(), 'workspace', 'application.revoke')).status).toBe(400);
    expect((await adminRequest(req({}, appToken), 'workspace', 'application.list')).status).toBe(
      403,
    );
    db.managedKeyApplication.findMany.mockResolvedValue([]);
    await adminRequest(adminReq({}, undefined, 'GET'), 'workspace', 'application.list');
    const listed = db.managedKeyApplication.findMany.mock.calls.at(-1)![0];
    expect(listed.select.tokenHash).toBeUndefined();
    expect(listed.where).toEqual({ workspaceId: 'ws-1' });
  });
});
