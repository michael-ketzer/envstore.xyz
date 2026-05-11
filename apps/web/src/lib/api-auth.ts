// Bearer-token authentication for /api/v1/* — the CLI's auth surface.
// CLI tokens are random secrets stored hashed (sha256) on the server.

import 'server-only';
import { headers } from 'next/headers';

import { prisma, type CliToken, type User } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';

export type AuthedCli = { user: User; cliToken: CliToken };

const BEARER_PREFIX = 'Bearer ';

export async function authenticateBearer(req: Request): Promise<AuthedCli | null> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith(BEARER_PREFIX)) return null;
  const token = auth.slice(BEARER_PREFIX.length).trim();
  if (!token || token.length > 200) return null;

  const tokenHash = await sha256Hex(token);
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
  return { user, cliToken: rest as CliToken };
}

export function requestIp(): string | null {
  // Synchronous-ish helper for use inside handlers that have already awaited headers().
  // Most callers go through `pickIp` below instead.
  return null;
}

export async function pickIp(): Promise<string | null> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
  );
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
