// Bearer-token authentication for /api/v1/* — the CLI's auth surface.
//
// Two credential kinds, both presented as `Authorization: Bearer <token>`:
//   1. CliToken — user-bound, minted via the device-grant login flow.
//   2. WorkspaceToken — workspace-bound service token (the `eswtok_` prefix),
//      minted by an admin and dropped into CI secret storage.
//
// Tokens are stored sha256-hashed; the cleartext is shown to the caller once
// at creation and never again. Routes that mutate workspace structure (token
// management, member roles, billing, settings, deletes) must additionally
// reject service-token auth via `requireUserAuth(auth)` — see WORKSPACE_TOKEN
// docs for the escalation invariant.

import 'server-only';

import { prisma, type CliToken, type User, type WorkspaceToken } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';
import { WORKSPACE_TOKEN_PREFIX } from '@envstore/shared';

export type AuthedUser = {
  kind: 'user';
  user: User;
  cliToken: CliToken;
};

export type AuthedWorkspaceToken = {
  kind: 'workspace-token';
  token: WorkspaceToken;
  // The workspace the token is scoped to. Routes use this directly without
  // resolving the workspaceSlug param — the token IS the workspace binding.
  workspaceId: string;
};

export type Authed = AuthedUser | AuthedWorkspaceToken;

const BEARER_PREFIX = 'Bearer ';

export async function authenticateBearer(req: Request): Promise<Authed | null> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith(BEARER_PREFIX)) return null;
  const token = auth.slice(BEARER_PREFIX.length).trim();
  if (!token || token.length > 200) return null;

  const tokenHash = await sha256Hex(token);

  // Discriminate by the visible prefix before we hit the DB. Token formats
  // are non-overlapping (user CLI tokens are 32 hex chars without prefix;
  // workspace tokens carry "eswtok_"), so this is exact.
  if (token.startsWith(WORKSPACE_TOKEN_PREFIX)) {
    const wsToken = await prisma.workspaceToken.findUnique({ where: { tokenHash } });
    if (!wsToken) return null;
    if (wsToken.revokedAt) return null;
    if (wsToken.expiresAt && wsToken.expiresAt < new Date()) return null;

    prisma.workspaceToken
      .update({ where: { id: wsToken.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return { kind: 'workspace-token', token: wsToken, workspaceId: wsToken.workspaceId };
  }

  const cliToken = await prisma.cliToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!cliToken) return null;
  if (cliToken.expiresAt && cliToken.expiresAt < new Date()) return null;

  // Fire-and-forget lastUsedAt update — we don't want to block API calls on it.
  prisma.cliToken
    .update({ where: { id: cliToken.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const { user, ...rest } = cliToken;
  return { kind: 'user', user, cliToken: rest as CliToken };
}

// Convenience for routes that need user-auth specifically — token creation,
// member management, settings changes, billing, deletes. The invariant is
// "a service token cannot mint another credential or change ACL." Any route
// gated by this returns 403 to token-auth.
export function requireUserAuth(auth: Authed): AuthedUser | Response {
  if (auth.kind !== 'user') {
    return apiError(
      'This endpoint requires user authentication; service tokens cannot perform it.',
      403,
    );
  }
  return auth;
}

// Back-compat type alias for the old `AuthedCli` name — callers that still
// reference it will keep compiling while we migrate.
export type AuthedCli = AuthedUser;

// Resolve a workspace by URL slug, granting access whether the caller is a
// user (must be a member) or a service token (must be scoped to that exact
// workspace). Returns null if either gate fails, so callers can render a
// uniform 404 without leaking whether the workspace exists.
export async function resolveWorkspaceForAuth(
  auth: Authed,
  workspaceSlug: string,
): Promise<{ id: string; slug: string } | null> {
  if (auth.kind === 'user') {
    return prisma.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deletedAt: null,
        members: { some: { userId: auth.user.id } },
      },
      select: { id: true, slug: true },
    });
  }
  return prisma.workspace.findFirst({
    where: { slug: workspaceSlug, deletedAt: null, id: auth.workspaceId },
    select: { id: true, slug: true },
  });
}

// Attribution fields for audit logging — `userId` for human-driven calls,
// `workspaceTokenId` for CI/CD calls. Exactly one is set.
export function auditFieldsFor(auth: Authed): {
  userId: string | null;
  workspaceTokenId: string | null;
} {
  return auth.kind === 'user'
    ? { userId: auth.user.id, workspaceTokenId: null }
    : { userId: null, workspaceTokenId: auth.token.id };
}

// Gate for /workspaces/<ws>/projects/<projectId>/... endpoints. Users always
// pass (they have workspace-wide access by membership); tokens pass only if
// they're workspace-wide or the project is in their allowlist.
export function tokenAllowsProject(auth: Authed, projectId: string): boolean {
  if (auth.kind === 'user') return true;
  const scope = auth.token.scopedProjectIds;
  if (scope.length === 0) return true; // empty = workspace-wide
  return scope.includes(projectId);
}

export function unauthorized(message = 'Not authenticated.'): Response {
  return apiError(message, 401);
}

export function forbidden(message = 'Forbidden.'): Response {
  return apiError(message, 403);
}

export function notFound(message = 'Not found.'): Response {
  return apiError(message, 404);
}

export function apiError(message: string, status: number, hint?: string): Response {
  return Response.json({ error: message, ...(hint ? { hint } : {}) }, { status });
}
