// Server-side helper that figures out how many env versions in a workspace
// were encrypted to a recipient set that's no longer current. The workspace
// home page surfaces this as a "run envstore rekey" banner.
//
// Why this matters: when a member joins (or registers a new identity), or a
// service token is created or revoked, existing ciphertext is still only
// readable by the OLD recipient set. The new identities can't decrypt until
// someone re-pushes. `envstore rekey` does that bulk re-push; this helper
// nudges the user to run it.

import 'server-only';

import { prisma } from '@envstore/db';
import { bytesToHex, recipientsHashHex } from '@envstore/crypto/hash';

export type RekeyStatus = {
  staleCount: number; // # env versions whose recipientsHash != current
  totalCount: number; // # env versions with a currentVersion at all
};

export async function computeRekeyStatus(workspaceId: string): Promise<RekeyStatus> {
  // Pull every env's current-version recipientsHash + the env's projectId.
  const envs = await prisma.environment.findMany({
    where: {
      deletedAt: null,
      project: { workspaceId, deletedAt: null },
    },
    select: {
      project: { select: { id: true } },
      currentVersion: { select: { recipientsHash: true } },
    },
  });

  // Member recipients (constant across projects) and token recipients
  // (scope-filtered per project).
  const [members, tokens] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        user: {
          select: { recipients: { select: { recipient: true } } },
        },
      },
    }),
    prisma.workspaceToken.findMany({
      // Mirror the recipient endpoint's filter — expired tokens are no longer
      // valid recipients, so their absence is what makes affected versions
      // count as stale and prompt rekey.
      where: {
        workspaceId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { recipient: true, scopedProjectIds: true },
    }),
  ]);

  const memberRecipients = members.flatMap((m) => m.user.recipients.map((r) => r.recipient));

  // Cache: projectId → current expected recipientsHash.
  const expectedByProject = new Map<string, string>();
  async function expectedHashFor(projectId: string): Promise<string> {
    const cached = expectedByProject.get(projectId);
    if (cached) return cached;
    const tokenRecipients = tokens
      .filter((t) => t.scopedProjectIds.length === 0 || t.scopedProjectIds.includes(projectId))
      .map((t) => t.recipient);
    const set = Array.from(new Set([...memberRecipients, ...tokenRecipients]));
    const hash = await recipientsHashHex(set);
    expectedByProject.set(projectId, hash);
    return hash;
  }

  let staleCount = 0;
  let totalCount = 0;
  for (const env of envs) {
    if (!env.currentVersion) continue;
    totalCount += 1;
    const actual = bytesToHex(new Uint8Array(env.currentVersion.recipientsHash));
    const expected = await expectedHashFor(env.project.id);
    if (actual !== expected) staleCount += 1;
  }
  return { staleCount, totalCount };
}
