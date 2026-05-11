import 'server-only';
import { randomBytes } from 'node:crypto';

import { prisma } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';
import { parseRecipient } from '@envstore/crypto/recipients';
import {
  WORKSPACE_TOKEN_PREFIX,
  detectRecipientKind,
  type WorkspaceTokenCreateInput,
} from '@envstore/shared';

// 32 bytes of crypto-random → base32 (RFC 4648, no padding), 52 chars.
// Combined with the prefix, the bearer is ~59 chars — pastes cleanly in
// CI env-var inputs, has ~256 bits of entropy.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

function generateBearer(): string {
  return `${WORKSPACE_TOKEN_PREFIX}${base32Encode(randomBytes(32))}`;
}

// Default + cap for token expiry. Long-lived service tokens are useful for
// CI/CD but unbounded lifetimes are a footgun (ex-employee retention); 90d
// is a sensible default that prompts rotation hygiene.
const DEFAULT_EXPIRES_IN_DAYS = 90;
const MAX_EXPIRES_IN_DAYS = 365;

export type CreateWorkspaceTokenResult =
  | {
      ok: true;
      // Returned ONCE to the caller — never persisted in plaintext.
      bearer: string;
      token: {
        id: string;
        name: string;
        recipient: string;
        scopes: string[];
        expiresAt: Date | null;
        createdAt: Date;
      };
    }
  | { ok: false; reason: 'invalid-recipient'; message: string };

export async function createWorkspaceToken(args: {
  workspaceId: string;
  createdByUserId: string;
  input: WorkspaceTokenCreateInput;
}): Promise<CreateWorkspaceTokenResult> {
  const { workspaceId, createdByUserId, input } = args;

  // Validate the recipient structurally — we only ever store age public keys
  // (or SSH pubkeys); a malformed string can't decrypt anything and would
  // break the CLI's encrypt-to-all flow.
  try {
    parseRecipient(input.recipient);
  } catch (err) {
    return { ok: false, reason: 'invalid-recipient', message: (err as Error).message };
  }
  const kind = detectRecipientKind(input.recipient) ?? 'AGE_X25519';

  const days = Math.min(input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS, MAX_EXPIRES_IN_DAYS);
  const expiresAt = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  // Loop a couple times in the cosmically unlikely event of a token hash
  // collision; sha256 of 256 random bits has no realistic clash.
  for (let i = 0; i < 4; i++) {
    const bearer = generateBearer();
    const tokenHash = await sha256Hex(bearer);
    const clash = await prisma.workspaceToken.findUnique({ where: { tokenHash } });
    if (clash) continue;
    const created = await prisma.workspaceToken.create({
      data: {
        workspaceId,
        name: input.name,
        tokenHash,
        recipient: input.recipient,
        recipientKind: kind,
        expiresAt,
        createdByUserId,
      },
      select: {
        id: true,
        name: true,
        recipient: true,
        scopes: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { ok: true, bearer, token: created };
  }
  throw new Error('Failed to allocate a unique workspace token after 4 attempts.');
}

export async function listWorkspaceTokens(workspaceId: string) {
  const tokens = await prisma.workspaceToken.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { email: true } } },
  });
  return tokens.map((t) => ({
    id: t.id,
    name: t.name,
    recipient: t.recipient,
    scopes: t.scopes,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    createdByEmail: t.createdBy?.email ?? null,
  }));
}

export type RevokeWorkspaceTokenResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' };

export async function revokeWorkspaceToken(
  workspaceId: string,
  tokenId: string,
): Promise<RevokeWorkspaceTokenResult> {
  const existing = await prisma.workspaceToken.findFirst({
    where: { id: tokenId, workspaceId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return { ok: false, reason: 'not-found' };
  // Idempotent: already-revoked is success.
  if (!existing.revokedAt) {
    await prisma.workspaceToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }
  return { ok: true };
}
