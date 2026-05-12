// GET + POST /api/v1/workspaces/[ws]/projects.
//
// GET: project-scoped service tokens see only their allowlisted projects
//      (F3 listing surface).
// POST: workspace-token cannot mint projects; valid create returns 201.

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  project: { findMany: mock(), findUnique: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

const fakeCreateProject = mock();

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/projects', () => ({ createProject: fakeCreateProject }));

const { GET, POST } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeCreateProject.mockReset();
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
  fakePrisma.project.findMany.mockResolvedValue([]);
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

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme' }) };

function getReq(bearer: string): Request {
  return new Request('https://envstore.xyz/api/v1/workspaces/acme/projects', {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer}` },
  });
}

function postReq(bearer: string, body: unknown): Request {
  return new Request('https://envstore.xyz/api/v1/workspaces/acme/projects', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /projects', () => {
  test('no bearer → 401', async () => {
    const r = new Request('https://envstore.xyz/api/v1/workspaces/acme/projects', { method: 'GET' });
    expect((await GET(r, ctx)).status).toBe(401);
  });

  test('user → 200, no project ID filter applied', async () => {
    await stageUserAuth('user-bearer');
    const res = await GET(getReq('user-bearer'), ctx);
    expect(res.status).toBe(200);
    const args = fakePrisma.project.findMany.mock.calls[0]?.[0] as {
      where: { workspaceId: string; deletedAt: null; id?: unknown };
    };
    expect(args.where.workspaceId).toBe('ws_1');
    expect(args.where.id).toBeUndefined();
  });

  test('workspace-wide service token → 200, no ID filter', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}WIDE`;
    await stageWorkspaceTokenAuth(bearer, []);
    const res = await GET(getReq(bearer), ctx);
    expect(res.status).toBe(200);
    const args = fakePrisma.project.findMany.mock.calls[0]?.[0] as {
      where: { id?: { in: string[] } };
    };
    expect(args.where.id).toBeUndefined();
  });

  test('F3: project-scoped token → 200 but listing is filtered to allowlist', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}SCOPED`;
    await stageWorkspaceTokenAuth(bearer, ['proj_api', 'proj_billing']);
    const res = await GET(getReq(bearer), ctx);
    expect(res.status).toBe(200);
    const args = fakePrisma.project.findMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } };
    };
    expect(args.where.id.in.sort()).toEqual(['proj_api', 'proj_billing']);
  });
});

describe('POST /projects', () => {
  test('workspace-token → 403 (service tokens cannot mint projects)', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer, []);
    const res = await POST(postReq(bearer, { name: 'API', slug: 'api' }), ctx);
    expect(res.status).toBe(403);
    expect(fakeCreateProject).not.toHaveBeenCalled();
  });

  test('user not a member → 404', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.workspace.findFirst.mockResolvedValueOnce(null);
    const res = await POST(postReq('user-bearer', { name: 'API', slug: 'api' }), ctx);
    expect(res.status).toBe(404);
    expect(fakeCreateProject).not.toHaveBeenCalled();
  });

  test('missing required field → 400', async () => {
    await stageUserAuth('user-bearer');
    const res = await POST(postReq('user-bearer', { slug: 'api' }), ctx);
    expect(res.status).toBe(400);
    expect(fakeCreateProject).not.toHaveBeenCalled();
  });

  test('slug already taken → 409', async () => {
    await stageUserAuth('user-bearer');
    fakeCreateProject.mockResolvedValueOnce({
      ok: false,
      reason: 'slug-taken',
      message: 'Slug already in use.',
    });
    const res = await POST(postReq('user-bearer', { name: 'API', slug: 'api' }), ctx);
    expect(res.status).toBe(409);
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('happy path → 201, audit recorded, returns project shape', async () => {
    await stageUserAuth('user-bearer');
    fakeCreateProject.mockResolvedValueOnce({
      ok: true,
      project: { id: 'proj_new', slug: 'api' },
    });
    fakePrisma.project.findUnique.mockResolvedValueOnce({
      slug: 'api',
      name: 'API',
      description: null,
      group: null,
    });

    const res = await POST(postReq('user-bearer', { name: 'API', slug: 'api' }), ctx);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ slug: 'api', name: 'API', description: null, group: null });

    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; resourceId: string };
    };
    expect(audit.data.action).toBe('project.create');
    expect(audit.data.resourceId).toBe('proj_new');
  });
});
