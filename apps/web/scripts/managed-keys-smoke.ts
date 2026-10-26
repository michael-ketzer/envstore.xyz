// Invoked by scripts/managed-keys/smoke.sh against disposable local services.
// Only the Next.js server-only import guard is replaced; DB, auth, routes,
// schema validation, policies, crypto, and OpenBao transport are real.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

mock.module('server-only', () => ({}));
const { SignJWT, exportJWK, generateKeyPair } = await import('jose');
const vercelKey = await generateKeyPair('RS256');
const vercelKeySet = {
  keys: [{ ...(await exportJWK(vercelKey.publicKey)), kid: 'smoke', alg: 'RS256' }],
};
const realFetch = globalThis.fetch;
// Stands in for Vercel's public key set only; OpenBao and everything else are real.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
  String(input) === 'https://oidc.vercel.com/.well-known/jwks'
    ? Response.json(vercelKeySet)
    : realFetch(input, init)) as typeof fetch;
const { prisma } = await import('@envstore/db');
const { adminRequest, runtimeRequest } = await import('../src/lib/managed-keys/service');
const { applicationRequest } = await import('../src/lib/managed-keys/applications');
const { runRetentionSweep } = await import('../src/lib/retention-sweep');
const adminToken = randomUUID();
const user = await prisma.user.create({ data: { email: `managed-${randomUUID()}@test.example` } });
const workspace = await prisma.workspace.create({
  data: {
    name: 'Managed key smoke test',
    slug: `managed-${randomUUID()}`,
    ownerId: user.id,
    members: { create: { userId: user.id, role: 'OWNER' } },
  },
});
await prisma.cliToken.create({
  data: {
    userId: user.id,
    name: 'test',
    tokenHash: createHash('sha256').update(adminToken).digest('hex'),
  },
});
const context = {
  purpose: 'shinra-creator-briefing-v1',
  teamId: 'team-1',
  campaignId: 'campaign-1',
  creatorId: 'creator-1',
  accessId: 'assignment-1',
};
const provision = {
  name: 'briefings',
  tenantId: context.teamId,
  environment: 'production',
  purpose: context.purpose,
};
function request(token: string, body?: unknown) {
  return new Request('https://envstore.test/v1/keys', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function result(response: Response, status = 200) {
  assert.equal(response.status, status, `Unexpected status: ${response.status}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

try {
  const first = await result(
    await adminRequest(request(adminToken, provision), workspace.slug, 'key.provision'),
  );
  const keyId = first.key.id;
  const again = await result(
    await adminRequest(request(adminToken, provision), workspace.slug, 'key.provision'),
  );
  assert.equal(again.key.id, keyId);
  assert.equal(again.keyVersion, first.keyVersion);
  const issue = () =>
    adminRequest(
      request(adminToken, {
        applicationId: 'shinra',
        tenantId: context.teamId,
        environment: 'production',
        grants: [{ keyId, operations: ['generate', 'unwrap'] }],
      }),
      workspace.slug,
      'credential.issue',
    );
  const credential = await result(await issue(), 201);
  for (const scope of [{ tenantId: 'team-2' }, { environment: 'staging' }]) {
    const other = await result(
      await adminRequest(
        request(adminToken, { ...provision, ...scope }),
        workspace.slug,
        'key.provision',
      ),
    );
    await result(
      await runtimeRequest(request(credential.token, { context }), other.key.id, 'generate'),
      403,
    );
    await result(
      await adminRequest(
        request(adminToken, {
          applicationId: 'shinra',
          tenantId: context.teamId,
          environment: 'production',
          grants: [{ keyId: other.key.id, operations: ['unwrap'] }],
        }),
        workspace.slug,
        'credential.issue',
      ),
      400,
    );
  }
  const generated = await result(
    await runtimeRequest(request(credential.token, { context }), keyId, 'generate'),
  );
  assert.equal(Buffer.from(generated.plaintextKey, 'base64').length, 32);
  assert.equal(generated.provider, 'envstore-openbao-transit');
  const generated2 = await result(
    await runtimeRequest(request(credential.token, { context }), keyId, 'generate'),
  );
  assert.notEqual(generated2.plaintextKey, generated.plaintextKey);
  const unwrap = (scope = context, wrappedKey = generated.wrappedKey) =>
    runtimeRequest(request(credential.token, { context: scope, wrappedKey }), keyId, 'unwrap');
  assert.equal((await result(await unwrap())).plaintextKey, generated.plaintextKey);
  const rotated = await result(
    await adminRequest(request(adminToken, {}), workspace.slug, 'key.rotate', keyId),
  );
  assert.equal(rotated.keyVersion, first.keyVersion + 1);
  assert.equal((await result(await unwrap())).plaintextKey, generated.plaintextKey);
  const fresh = await result(
    await runtimeRequest(request(credential.token, { context }), keyId, 'generate'),
  );
  const transitCiphertext = Buffer.from(fresh.wrappedKey.split('.')[3], 'base64url').toString();
  assert.ok(transitCiphertext.startsWith(`vault:v${rotated.keyVersion}:`));
  for (const field of ['campaignId', 'creatorId', 'accessId']) {
    await result(await unwrap({ ...context, [field]: 'different' }), 400);
  }
  await result(await unwrap({ ...context, teamId: 'another-team' }), 403);
  await result(await unwrap(context, 'aws-kms-wrapped-key'), 400);
  await result(
    await adminRequest(request(credential.token, provision), workspace.slug, 'key.provision'),
    403,
  );
  await result(await runtimeRequest(request(adminToken, { context }), keyId, 'generate'), 401);
  await result(
    await adminRequest(
      request(adminToken, { ...provision, purpose: 'changed' }),
      workspace.slug,
      'key.provision',
    ),
    409,
  );

  // Real OpenBao policies must deny privileged actions, independent of envstore.
  async function engineRequest(token: string, path: string, body: unknown) {
    const r = await fetch(`${process.env.OPENBAO_URL}/v1/transit/${path}`, {
      method: 'POST',
      headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await r.body?.cancel();
    return r.status;
  }
  assert.equal(
    await engineRequest(process.env.OPENBAO_RUNTIME_TOKEN!, `keys/envstore-${keyId}/rotate`, {}),
    403,
  );
  assert.equal(
    await engineRequest(process.env.OPENBAO_ADMIN_TOKEN!, `keys/envstore-${keyId}/config`, {
      deletion_allowed: true,
    }),
    403,
  );
  assert.equal(
    await engineRequest(process.env.OPENBAO_ADMIN_TOKEN!, `decrypt/envstore-${keyId}`, {
      ciphertext: transitCiphertext,
    }),
    403,
  );

  await result(
    await adminRequest(request(adminToken, {}), workspace.slug, 'credential.revoke', credential.id),
  );
  await result(await unwrap(), 401);
  await result(
    await adminRequest(request(adminToken, {}), workspace.slug, 'credential.revoke', credential.id),
  );
  const replacement = await result(await issue(), 201);
  await result(await adminRequest(request(adminToken, {}), workspace.slug, 'key.disable', keyId));
  await result(
    await runtimeRequest(request(replacement.token, { context }), keyId, 'generate'),
    403,
  );
  await result(
    await runtimeRequest(
      request(replacement.token, { context, wrappedKey: generated.wrappedKey }),
      keyId,
      'unwrap',
    ),
    403,
  );
  await result(
    await adminRequest(request(adminToken, {}), workspace.slug, 'key.rotate', keyId),
    409,
  );
  await result(await adminRequest(request(adminToken, {}), workspace.slug, 'key.disable', keyId));
  const audit = await result(await adminRequest(request(adminToken), workspace.slug, 'audit.list'));
  assert.ok(audit.events.some((e: { outcome: string }) => e.outcome === 'denied'));
  assert.ok(
    audit.events.some(
      (e: { keyId: string; operation: string }) =>
        e.keyId === keyId && e.operation === 'key.provision',
    ),
  );
  assert.ok(!JSON.stringify(audit).includes(generated.plaintextKey));
  assert.ok(!JSON.stringify(audit).includes(generated.wrappedKey));
  assert.ok(!JSON.stringify(audit).includes(context.campaignId));
  // Applications: one registration serves every tenant; tenant keys appear on first use.
  const deployment = (claims: Record<string, string> = {}) =>
    new SignJWT({
      owner_id: 'team_smoke',
      project_id: 'prj_smoke',
      environment: 'production',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'smoke' })
      .setIssuer('https://oidc.vercel.com/smoke')
      .setAudience(process.env.NEXT_PUBLIC_APP_URL!)
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(vercelKey.privateKey);
  const register = (body: unknown) =>
    adminRequest(request(adminToken, body), workspace.slug, 'application.register');
  const application = {
    name: 'shinra-production',
    environment: 'production',
    purpose: context.purpose,
    keyName: 'creator-briefings',
    maxTenants: 3,
    vercel: { teamId: 'team_smoke', projectId: 'prj_smoke', environment: 'production' },
  };
  const registered = await result(await register(application), 201);
  assert.equal(
    (await result(await register(application))).application.id,
    registered.application.id,
  );
  await result(await register({ ...application, name: 'duplicate' }), 409);
  const appRequest = (token: string, body: unknown, operation: 'generate' | 'unwrap') =>
    applicationRequest(request(token, body), workspace.slug, operation);
  // A key created by an administrator for tenant credentials stays readable.
  const legacy = await result(
    await adminRequest(
      request(adminToken, { ...provision, tenantId: 'team-3', name: 'creator-briefings' }),
      workspace.slug,
      'key.provision',
    ),
  );
  const legacyCredential = await result(
    await adminRequest(
      request(adminToken, {
        applicationId: 'shinra',
        tenantId: 'team-3',
        environment: 'production',
        grants: [{ keyId: legacy.key.id, operations: ['generate'] }],
      }),
      workspace.slug,
      'credential.issue',
    ),
    201,
  );
  const tenant3 = { ...context, teamId: 'team-3' };
  const legacyEnvelope = await result(
    await runtimeRequest(
      request(legacyCredential.token, { context: tenant3 }),
      legacy.key.id,
      'generate',
    ),
  );
  const token = await deployment();
  const reopened = await result(
    await appRequest(
      token,
      { context: tenant3, keyId: legacy.key.id, wrappedKey: legacyEnvelope.wrappedKey },
      'unwrap',
    ),
  );
  assert.equal(reopened.plaintextKey, legacyEnvelope.plaintextKey);
  // A new tenant gets its own engine key on first use, then reuses it.
  const tenant4 = { ...context, teamId: 'team-4' };
  const firstUse = await result(await appRequest(token, { context: tenant4 }, 'generate'));
  const reuse = await result(await appRequest(token, { context: tenant4 }, 'generate'));
  assert.equal(reuse.keyId, firstUse.keyId);
  assert.notEqual(firstUse.keyId, legacy.key.id);
  const created = await prisma.managedKey.findUniqueOrThrow({ where: { id: firstUse.keyId } });
  assert.equal(created.tenantId, 'team-4');
  assert.equal(created.name, 'creator-briefings');
  assert.ok(created.provisionedAt);
  const envelope = { context: tenant4, keyId: firstUse.keyId, wrappedKey: firstUse.wrappedKey };
  assert.equal(
    (await result(await appRequest(token, envelope, 'unwrap'))).plaintextKey,
    firstUse.plaintextKey,
  );
  // Tenant, deployment environment, audience, and limits all bind.
  await result(
    await appRequest(token, { ...envelope, context: { ...tenant4, teamId: 'team-3' } }, 'unwrap'),
    403,
  );
  await result(
    await appRequest(token, { ...envelope, context: { ...tenant4, campaignId: 'x' } }, 'unwrap'),
    400,
  );
  await result(
    await appRequest(await deployment({ environment: 'preview' }), envelope, 'unwrap'),
    403,
  );
  await result(
    await appRequest(await deployment({ project_id: 'prj_other' }), envelope, 'unwrap'),
    403,
  );
  await result(await appRequest(token, { context: { ...context, teamId: 'team-5' } }, 'generate'));
  await result(
    await appRequest(token, { context: { ...context, teamId: 'team-6' } }, 'generate'),
    403,
  );
  assert.equal(await prisma.managedKey.count({ where: { tenantId: 'team-6' } }), 0);
  // Static tokens for callers outside Vercel.
  const { vercel: _, ...scope } = application;
  const issued = await result(
    await register({ ...scope, name: 'shinra-local', token: { expiresInDays: 1 } }),
    201,
  );
  assert.equal(
    (await result(await appRequest(issued.token, envelope, 'unwrap'))).plaintextKey,
    firstUse.plaintextKey,
  );
  // Real concurrency: the tenant limit and one-application-per-deployment hold.
  const racer = await result(
    await register({
      ...scope,
      name: 'race',
      keyName: 'race-keys',
      maxTenants: 2,
      token: { expiresInDays: 1 },
    }),
    201,
  );
  const raced = await Promise.all(
    // Enough contention to exceed the limit without serialization (checked).
    Array.from({ length: 30 }, (_, n) => n + 1).map((n) =>
      appRequest(racer.token, { context: { ...context, teamId: `race-${n}` } }, 'generate'),
    ),
  );
  assert.equal(raced.filter((r) => r.status === 200).length, 2);
  assert.ok(raced.every((r) => r.status === 200 || r.status === 403));
  assert.equal(await prisma.managedKey.count({ where: { name: 'race-keys' } }), 2);
  const preview = { ...application.vercel, environment: 'preview' };
  const registrations = await Promise.all(
    Array.from({ length: 10 }, (_, n) =>
      register({ ...application, name: `dup-${n}`, vercel: preview }),
    ),
  );
  assert.equal(registrations.filter((r) => r.status === 201).length, 1);
  assert.ok(registrations.every((r) => r.status === 201 || r.status === 409));
  await result(
    await adminRequest(
      request(adminToken, {}),
      workspace.slug,
      'application.revoke',
      registered.application.id,
    ),
  );
  await result(await appRequest(token, envelope, 'unwrap'), 403);
  const events = await prisma.managedKeyAuditEvent.findMany({
    where: { applicationId: registered.application.id },
  });
  assert.ok(events.some((e) => e.operation === 'key.provision' && e.keyId === firstUse.keyId));
  assert.ok(!JSON.stringify(events).includes(firstUse.plaintextKey));
  await prisma.workspace.update({ where: { id: workspace.id }, data: { deletedAt: new Date(0) } });
  await runRetentionSweep();
  assert.ok(await prisma.workspace.findUnique({ where: { id: workspace.id } }));
  await result(
    await runtimeRequest(request(replacement.token, { context }), keyId, 'generate'),
    401,
  );
  await result(await appRequest(issued.token, envelope, 'unwrap'), 401);
  process.stdout.write(
    'Managed-key smoke passed: provisioning, isolation, generate/unwrap, rotation, ACLs, revocation, disable, applications, audit, and retention.\n',
  );
} finally {
  await prisma.$disconnect();
}
