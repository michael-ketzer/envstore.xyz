// CLI token issuance + revocation.
//
// Tokens are random 32-byte secrets, base64url-encoded with an `est_` prefix
// for human recognizability. Only the sha256 hash is persisted; the plaintext
// is shown to the client exactly once (returned at the end of the device-code
// approval flow).

import 'server-only';
import { randomBytes } from 'node:crypto';

import { prisma } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';
import { DEFAULTS } from '@envstore/shared';

const TOKEN_PREFIX = 'est_';

// Default lifetime. Forces re-`envstore login` every 90 days so an accidentally
// leaked-and-forgotten token has a bounded blast radius. The previous 365-day
// default was friendlier on UX but oversized for a credential that grants full
// API access — 90 days matches what most modern PAT systems do (GitHub fine-
// grained tokens, npm tokens) and lets the per-user cap + LRU eviction recycle
// stale tokens faster. Users can still revoke earlier from
// /dashboard/account/cli-sessions.
const DEFAULT_TOKEN_TTL_DAYS = 90;

export function generateCliToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export type IssueCliTokenInput = {
  userId: string;
  name: string;
};

// Issues a token, enforcing a per-user cap. If the user is over the cap, the
// OLDEST unused token is revoked to make room.
export async function issueCliToken(input: IssueCliTokenInput): Promise<{
  token: string;
  cliTokenId: string;
}> {
  const token = generateCliToken();
  const tokenHash = await sha256Hex(token);

  const existing = await prisma.cliToken.count({ where: { userId: input.userId } });
  if (existing >= DEFAULTS.maxCliTokensPerUser) {
    const oldest = await prisma.cliToken.findFirst({
      where: { userId: input.userId },
      orderBy: [{ lastUsedAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (oldest) {
      await prisma.cliToken.delete({ where: { id: oldest.id } });
    }
  }

  const expiresAt = new Date(
    Date.now() + DEFAULT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const created = await prisma.cliToken.create({
    data: {
      userId: input.userId,
      name: input.name.slice(0, 80),
      tokenHash,
      expiresAt,
    },
    select: { id: true },
  });
  return { token, cliTokenId: created.id };
}

export async function revokeCliToken(id: string, userId: string): Promise<boolean> {
  const result = await prisma.cliToken.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}
