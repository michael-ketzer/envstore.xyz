// Invoked by scripts/managed-keys/smoke.sh against disposable local services.
// Only the Next.js server-only import guard is replaced; DB, auth, routes,
// schema validation, policies, crypto, and OpenBao transport are real.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

mock.module('server-only', () => ({}));
const { prisma } = await import('@envstore/db');
const { adminRequest, runtimeRequest } = await import('../src/lib/managed-keys/service');
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
  await prisma.workspace.update({ where: { id: workspace.id }, data: { deletedAt: new Date(0) } });
  await runRetentionSweep();
  assert.ok(await prisma.workspace.findUnique({ where: { id: workspace.id } }));
  await result(
    await runtimeRequest(request(replacement.token, { context }), keyId, 'generate'),
    401,
  );
  process.stdout.write(
    'Managed-key smoke passed: provisioning, isolation, generate/unwrap, rotation, ACLs, revocation, disable, audit, and retention.\n',
  );
} finally {
  await prisma.$disconnect();
}
