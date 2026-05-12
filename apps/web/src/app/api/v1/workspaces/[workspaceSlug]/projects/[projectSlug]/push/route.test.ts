// Tests for POST /push (init upload).
//
// Beyond the routine auth gates this route owns the policy decisions:
//   - F2 billing-write gate (writes blocked on read-only / locked tiers)
//   - F3 project-scope gate (scoped service token must include this project)
//   - body validation (hash format, ciphertext-size cap, slug shape)
//   - soft-deleted environment conflict (409, not silent un-delete)
//   - R2NotConfiguredError surfaces as 503 (not 500)

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { LIMITS, WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';
import { FakeR2NotConfigured, makeR2Mock } from '@/test/r2-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findFirst: mock() },
  environment: { upsert: mock() },
  envFileVersion: { findFirst: mock(), create: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

const fakePresignPut = mock();

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/r2', () => makeR2Mock({ presignPut: fakePresignPut }));

const { POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakePresignPut.mockReset();
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
});

async function stageUserAuth(bearer: string) {
  const tokenHash = await sha256Hex(bearer);
  fakePrisma.cliToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
    if (args.where.tokenHash !== tokenHash) return null;
    return {
      id: 'tok_1',
      userId: 'u_1',
      name: 'cli',
      tokenHash,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      user: {
        id: 'u_1',
        email: 'alice@example.com',
        name: null,
        emailVerified: new Date(),
        image: null,
        paddleCustomerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  });
}

async function stageWorkspaceTokenAuth(bearer: string, scopedProjectIds: string[]) {
  const tokenHash = await sha256Hex(bearer);
  fakePrisma.workspaceToken.findUnique.mockImplementation(async (args: { where: { tokenHash: string } }) => {
    if (args.where.tokenHash !== tokenHash) return null;
    return {
      id: 'wstok_1',
      workspaceId: 'ws_1',
      name: 'ci',
      tokenHash,
      recipient: 'age1stub',
      recipientKind: 'AGE_X25519',
      scopes: ['read', 'write'],
      scopedProjectIds,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdByUserId: 'u_admin',
      createdAt: new Date(),
    };
  });
}

const ACTIVE_SUB = {
  status: 'ACTIVE',
  trialEndsAt: null,
  canceledAt: null,
  paddleSubscriptionId: 'sub_1',
};

function stageWorkspace() {
  fakePrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'ws_1', slug: 'acme' });
}

function stageProject(subscription: Record<string, unknown> | null) {
  fakePrisma.project.findFirst.mockResolvedValueOnce({
    id: 'proj_api',
    workspaceId: 'ws_1',
    workspace: { type: 'TEAM', subscription },
  });
}

function stageEnvironmentUpsert(opts: { deletedAt?: Date | null } = {}) {
  fakePrisma.environment.upsert.mockResolvedValueOnce({
    id: 'env_dev',
    slug: 'development',
    deletedAt: opts.deletedAt ?? null,
  });
}

function stageVersionCreate(version: number) {
  fakePrisma.envFileVersion.findFirst.mockResolvedValueOnce(
    version > 1 ? { version: version - 1 } : null,
  );
  fakePrisma.envFileVersion.create.mockResolvedValueOnce({ id: `ver_${version}`, version });
}

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme', projectSlug: 'api' }) };

const HEX64 = 'f'.repeat(64);
const VALID_BODY = {
  env: 'development',
  ciphertextSize: 1024,
  ciphertextSha256: HEX64,
  recipientsHash: HEX64,
};

function buildReq(bearer: string, body: unknown): Request {
  return new Request(
    'https://envstore.xyz/api/v1/workspaces/acme/projects/api/push',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('POST /push — happy paths', () => {
  test('user auth + active subscription → 200, presign returned, audit recorded', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    stageEnvironmentUpsert();
    stageVersionCreate(1);
    fakePresignPut.mockResolvedValueOnce({
      url: 'https://r2.signed/v1',
      requiredHeaders: {},
      expiresIn: 300,
    });

    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { versionId: string; uploadUrl: string };
    expect(body.versionId).toBe('ver_1');
    expect(body.uploadUrl).toBe('https://r2.signed/v1');

    // Audit attribution must reflect the user, not a workspace token.
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { userId: string | null; workspaceTokenId: string | null; metadata: { via: string } };
    };
    expect(audit.data.userId).toBe('u_1');
    expect(audit.data.workspaceTokenId).toBeNull();
    expect(audit.data.metadata.via).toBe('cli');
  });

  test('workspace-token auth → 200, audit attributes to workspaceTokenId, "via: workspace-token"', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}CI`;
    await stageWorkspaceTokenAuth(bearer, []);
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    stageEnvironmentUpsert();
    stageVersionCreate(1);
    fakePresignPut.mockResolvedValueOnce({ url: 'u', requiredHeaders: {}, expiresIn: 300 });

    const res = await POST(buildReq(bearer, VALID_BODY), ctx);
    expect(res.status).toBe(200);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { userId: string | null; workspaceTokenId: string | null; metadata: { via: string } };
    };
    expect(audit.data.userId).toBeNull();
    expect(audit.data.workspaceTokenId).toBe('wstok_1');
    expect(audit.data.metadata.via).toBe('workspace-token');

    // Version row attributes back to the admin who minted the token
    // (no row may be created with a null createdByUserId).
    const versionCreate = fakePrisma.envFileVersion.create.mock.calls[0]?.[0] as {
      data: { createdByUserId: string };
    };
    expect(versionCreate.data.createdByUserId).toBe('u_admin');
  });
});

describe('POST /push — auth + scope gates', () => {
  test('no bearer → 401, no DB lookups', async () => {
    const r = new Request(
      'https://envstore.xyz/api/v1/workspaces/acme/projects/api/push',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
    );
    const res = await POST(r, ctx);
    expect(res.status).toBe(401);
    expect(fakePrisma.workspace.findFirst).not.toHaveBeenCalled();
  });

  test('project not found → 404', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    fakePrisma.project.findFirst.mockResolvedValueOnce(null);
    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(404);
  });

  test('F3: project-scoped token NOT covering this project → 403, no version row created', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}ELSEWHERE`;
    await stageWorkspaceTokenAuth(bearer, ['proj_OTHER']);
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    const res = await POST(buildReq(bearer, VALID_BODY), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.envFileVersion.create).not.toHaveBeenCalled();
    expect(fakePresignPut).not.toHaveBeenCalled();
  });
});

describe('POST /push — F2 billing-write gate', () => {
  test('trial-expired → 402 read-only (writes blocked), no presign issued', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject({
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() - 60_000),
      canceledAt: null,
      paddleSubscriptionId: null,
    });
    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(402);
    expect(fakePrisma.envFileVersion.create).not.toHaveBeenCalled();
    expect(fakePresignPut).not.toHaveBeenCalled();
  });

  test('cancel-grace (still read-only) → 402, no presign', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject({
      status: 'CANCELED',
      canceledAt: new Date(Date.now() - 60_000),
      trialEndsAt: null,
      paddleSubscriptionId: 'sub_1',
    });
    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(402);
    expect(fakePresignPut).not.toHaveBeenCalled();
  });

  test('workspace with no subscription row → 402 (unconfigured = locked)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(null);
    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(402);
    expect(fakePresignPut).not.toHaveBeenCalled();
  });
});

describe('POST /push — body validation', () => {
  test('invalid JSON → 400', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    const r = new Request(
      'https://envstore.xyz/api/v1/workspaces/acme/projects/api/push',
      {
        method: 'POST',
        headers: { authorization: 'Bearer user-bearer', 'content-type': 'application/json' },
        body: '{not-json',
      },
    );
    const res = await POST(r, ctx);
    expect(res.status).toBe(400);
  });

  test('ciphertextSha256 not lowercase hex(64) → 400', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    const res = await POST(
      buildReq('user-bearer', { ...VALID_BODY, ciphertextSha256: 'ABCDEF' }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(fakePrisma.envFileVersion.create).not.toHaveBeenCalled();
  });

  test('ciphertextSize over the 1 MB cap → 400', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    const res = await POST(
      buildReq('user-bearer', { ...VALID_BODY, ciphertextSize: LIMITS.maxCiphertextBytes + 1 }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(fakePresignPut).not.toHaveBeenCalled();
  });

  test('non-positive ciphertextSize → 400', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    const res = await POST(buildReq('user-bearer', { ...VALID_BODY, ciphertextSize: 0 }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('POST /push — environment lifecycle', () => {
  test('soft-deleted environment → 409 (cannot write; user must restore first)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    stageEnvironmentUpsert({ deletedAt: new Date() });
    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(409);
    expect(fakePrisma.envFileVersion.create).not.toHaveBeenCalled();
    expect(fakePresignPut).not.toHaveBeenCalled();
  });

  test('next version number is one more than the previous max', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    stageEnvironmentUpsert();
    stageVersionCreate(7);
    fakePresignPut.mockResolvedValueOnce({ url: 'u', requiredHeaders: {}, expiresIn: 300 });

    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(200);
    const createArgs = fakePrisma.envFileVersion.create.mock.calls[0]?.[0] as {
      data: { version: number };
    };
    expect(createArgs.data.version).toBe(7);
  });
});

describe('POST /push — R2 failure paths', () => {
  test('R2 not configured at presign → 503 (not 500)', async () => {
    await stageUserAuth('user-bearer');
    stageWorkspace();
    stageProject(ACTIVE_SUB);
    stageEnvironmentUpsert();
    stageVersionCreate(1);
    fakePresignPut.mockRejectedValueOnce(new FakeR2NotConfigured());

    const res = await POST(buildReq('user-bearer', VALID_BODY), ctx);
    expect(res.status).toBe(503);
  });
});
