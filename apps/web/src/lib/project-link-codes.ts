// Setup codes for `envstore link <CODE>`.
//
// One durable code per project, stored on the project row. Created when the
// project is created (or lazy-filled on first read for legacy rows). The code
// is not a credential — workspace membership is what gates redemption.

import 'server-only';
import { randomInt } from 'node:crypto';

import { prisma } from '@envstore/db';
import {
  DEVICE_CODE_USER_CODE_ALPHABET,
  DEVICE_CODE_USER_CODE_LENGTH,
  DEVICE_CODE_USER_CODE_REGEX,
} from '@envstore/shared';

function generateRawCode(): string {
  let out = '';
  for (let i = 0; i < DEVICE_CODE_USER_CODE_LENGTH; i++) {
    out += DEVICE_CODE_USER_CODE_ALPHABET[randomInt(0, DEVICE_CODE_USER_CODE_ALPHABET.length)];
  }
  return out;
}

// Pick a code that isn't taken by any existing project. Retried a few times to
// dodge the (vanishingly rare) collision.
export async function pickUniqueLinkCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = generateRawCode();
    const clash = await prisma.project.findUnique({ where: { linkCode: candidate } });
    if (!clash) return candidate;
  }
  throw new Error('Failed to allocate a unique project link code.');
}

export function normalizeLinkCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function formatLinkCode(code: string): string {
  const n = normalizeLinkCode(code);
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}

// Reads the project's existing code; generates and persists one if missing.
// Idempotent under races thanks to the unique constraint — if a concurrent
// writer beats us, we re-read the now-set value.
export async function ensureLinkCode(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { linkCode: true },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);
  if (project.linkCode) return project.linkCode;

  const code = await pickUniqueLinkCode();
  try {
    await prisma.project.update({ where: { id: projectId }, data: { linkCode: code } });
    return code;
  } catch {
    const fresh = await prisma.project.findUnique({
      where: { id: projectId },
      select: { linkCode: true },
    });
    return fresh?.linkCode ?? code;
  }
}

export type RedeemResult =
  | {
      ok: true;
      workspace: { slug: string };
      project: { slug: string };
    }
  | {
      ok: false;
      reason: 'not-found' | 'not-a-member';
      message: string;
    };

// Anyone who is a member of the project's workspace can redeem.
// No expiry, no consumption — the workspace-membership check is the gate.
export async function redeemLinkCode(opts: {
  code: string;
  userId: string;
}): Promise<RedeemResult> {
  const normalized = normalizeLinkCode(opts.code);
  if (!DEVICE_CODE_USER_CODE_REGEX.test(normalized)) {
    return { ok: false, reason: 'not-found', message: 'Code format is invalid.' };
  }

  const project = await prisma.project.findUnique({
    where: { linkCode: normalized },
    include: {
      workspace: { select: { id: true, slug: true, deletedAt: true } },
    },
  });
  if (!project || project.deletedAt || project.workspace.deletedAt) {
    return { ok: false, reason: 'not-found', message: 'Code not found.' };
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: opts.userId } },
  });
  if (!member) {
    return {
      ok: false,
      reason: 'not-a-member',
      message: 'You are not a member of this workspace. Ask the owner to invite you.',
    };
  }

  return {
    ok: true,
    workspace: { slug: project.workspace.slug },
    project: { slug: project.slug },
  };
}
