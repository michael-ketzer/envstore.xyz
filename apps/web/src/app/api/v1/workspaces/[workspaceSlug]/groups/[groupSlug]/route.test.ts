// GET + PATCH + DELETE /api/v1/workspaces/[ws]/groups/[grp].
//
// DELETE has a tighter gate than the other group routes: ADMIN/OWNER only,
// since cascade-soft-deletes the entire group. Token-auth can never reach
// PATCH or DELETE (requireUserAuth).

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

import { makeDbMock } from '@/test/db-mock';

const fakePrisma = {
  workspace: { findFirst: mock() },
  workspaceMember: { findUnique: mock() },
  projectGroup: { findFirst: mock() },
  cliToken: { findUnique: mock(), update: mock() },
  workspaceToken: { findUnique: mock(), update: mock() },
  auditLog: { create: mock() },
};

const fakeUpdateGroup = mock();
const fakeSoftDelete = mock();

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ headers: async () => new Headers() }));
mock.module('@envstore/db', () => makeDbMock({ prisma: fakePrisma }));
mock.module('@/lib/project-groups', () => ({
  updateProjectGroup: fakeUpdateGroup,
  softDeleteProjectGroup: fakeSoftDelete,
}));

const { GET, PATCH, DELETE } = await import('./route');

beforeEach(() => {
  for (const m of Object.values(fakePrisma)) {
    for (const fn of Object.values(m)) (fn as ReturnType<typeof mock>).mockReset();
  }
  fakeUpdateGroup.mockReset();
  fakeSoftDelete.mockReset();
  fakePrisma.cliToken.update.mockResolvedValue({});
  fakePrisma.workspaceToken.update.mockResolvedValue({});
  fakePrisma.auditLog.create.mockResolvedValue({});
  fakePrisma.workspace.findFirst.mockResolvedValue({ id: 'ws_1', slug: 'acme' });
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

function stageMembership(role: 'OWNER' | 'ADMIN' | 'MEMBER' | null) {
  if (role === null) fakePrisma.workspaceMember.findUnique.mockResolvedValue(null);
  else fakePrisma.workspaceMember.findUnique.mockResolvedValue({ role });
}

const ctx = { params: Promise.resolve({ workspaceSlug: 'acme', groupSlug: 'backend' }) };

function req(method: string, bearer: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('https://envstore.xyz/api/v1/workspaces/acme/groups/backend', init);
}

describe('GET /groups/:slug', () => {
  test('F3: project-scoped service token → 403, never reads group row', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}SCOPED`;
    await stageWorkspaceTokenAuth(bearer, ['proj_api']);
    const res = await GET(req('GET', bearer), ctx);
    expect(res.status).toBe(403);
    expect(fakePrisma.projectGroup.findFirst).not.toHaveBeenCalled();
  });

  test('group not found → 404', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.projectGroup.findFirst.mockResolvedValueOnce(null);
    const res = await GET(req('GET', 'user-bearer'), ctx);
    expect(res.status).toBe(404);
  });

  test('user → 200, returns slug/name/description and live projects', async () => {
    await stageUserAuth('user-bearer');
    fakePrisma.projectGroup.findFirst.mockResolvedValueOnce({
      slug: 'backend',
      name: 'Backend',
      description: 'all the things',
      projects: [{ slug: 'api', name: 'API', description: null }],
    });
    const res = await GET(req('GET', 'user-bearer'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toBe('backend');
    expect((body.projects as unknown[]).length).toBe(1);
  });
});

describe('PATCH /groups/:slug', () => {
  test('workspace-token → 403', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer, []);
    const res = await PATCH(req('PATCH', bearer, { name: 'X' }), ctx);
    expect(res.status).toBe(403);
    expect(fakeUpdateGroup).not.toHaveBeenCalled();
  });

  test('group not found in workspace → 404 from helper', async () => {
    await stageUserAuth('user-bearer');
    fakeUpdateGroup.mockResolvedValueOnce({ ok: false, message: 'Group not found.' });
    const res = await PATCH(req('PATCH', 'user-bearer', { name: 'New name' }), ctx);
    expect(res.status).toBe(404);
  });

  test('user (any role) → 200, helper invoked with workspace + slug', async () => {
    await stageUserAuth('user-bearer');
    fakeUpdateGroup.mockResolvedValueOnce({ ok: true });
    const res = await PATCH(req('PATCH', 'user-bearer', { name: 'New name' }), ctx);
    expect(res.status).toBe(200);
    expect(fakeUpdateGroup).toHaveBeenCalledTimes(1);
    const [wsId, slug] = fakeUpdateGroup.mock.calls[0] as [string, string, unknown];
    expect(wsId).toBe('ws_1');
    expect(slug).toBe('backend');
    expect(fakePrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /groups/:slug', () => {
  test('workspace-token → 403', async () => {
    const bearer = `${WORKSPACE_TOKEN_PREFIX}TOK`;
    await stageWorkspaceTokenAuth(bearer, []);
    expect((await DELETE(req('DELETE', bearer), ctx)).status).toBe(403);
    expect(fakeSoftDelete).not.toHaveBeenCalled();
  });

  test('MEMBER → 403 (group deletes are cascading; tighter gate than PATCH)', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('MEMBER');
    const res = await DELETE(req('DELETE', 'user-bearer'), ctx);
    expect(res.status).toBe(403);
    expect(fakeSoftDelete).not.toHaveBeenCalled();
  });

  test('ADMIN → 200, soft-delete fires, audit recorded', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakeSoftDelete.mockResolvedValueOnce({ ok: true });
    const res = await DELETE(req('DELETE', 'user-bearer'), ctx);
    expect(res.status).toBe(200);
    expect(fakeSoftDelete).toHaveBeenCalledTimes(1);
    const audit = fakePrisma.auditLog.create.mock.calls[0]?.[0] as { data: { action: string } };
    expect(audit.data.action).toBe('projectGroup.soft-delete');
  });

  test('OWNER → 200 (passes ≥ ADMIN)', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('OWNER');
    fakeSoftDelete.mockResolvedValueOnce({ ok: true });
    expect((await DELETE(req('DELETE', 'user-bearer'), ctx)).status).toBe(200);
  });

  test('helper not-found → 404', async () => {
    await stageUserAuth('user-bearer');
    stageMembership('ADMIN');
    fakeSoftDelete.mockResolvedValueOnce({ ok: false, message: 'Group not found.' });
    expect((await DELETE(req('DELETE', 'user-bearer'), ctx)).status).toBe(404);
    expect(fakePrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
