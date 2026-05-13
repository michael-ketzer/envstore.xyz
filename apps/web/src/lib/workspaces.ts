import 'server-only';
import { randomBytes } from 'node:crypto';

import { prisma, type Prisma } from '@envstore/db';
import {
  slugify,
  DEFAULTS,
  PERSONAL_WORKSPACE_URL_SLUG,
  PRICING,
  validateWorkspaceSlug,
  type WorkspaceCreateInput,
} from '@envstore/shared';

// Pick a unique workspace slug. Starts from `base`, falls back to `base-<6-hex>`
// on collision or when the sanitized base would clash with a reserved slug
// (`admin`, `api`, `dashboard`, …). A reserved bare slug confuses the dashboard
// router and is rejected for team workspaces, so personal workspaces shouldn't
// be allowed to claim one either.
async function pickUniqueSlug(base: string): Promise<string> {
  const sanitized = slugify(base) || 'workspace';
  if (validateWorkspaceSlug(sanitized).ok) {
    const existing = await prisma.workspace.findUnique({ where: { slug: sanitized } });
    if (!existing) return sanitized;
  }
  for (let i = 0; i < 4; i++) {
    const suffix = randomBytes(3).toString('hex');
    const candidate = `${sanitized}-${suffix}`.slice(0, 40);
    if (!validateWorkspaceSlug(candidate).ok) continue;
    const clash = await prisma.workspace.findUnique({ where: { slug: candidate } });
    if (!clash) return candidate;
  }
  throw new Error('Failed to allocate a unique workspace slug.');
}

// Idempotent — creates a single personal workspace per user with a trialing subscription.
export async function ensurePersonalWorkspace(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`User ${userId} not found`);

  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, type: 'PERSONAL', deletedAt: null },
  });
  if (existing) return;

  // Slug is opaque random — we used to derive it from the email local-part
  // (`alice@…` → `alice`), which leaked the address as a URL segment and in
  // any audit-log row that referenced the workspace by slug. The personal
  // workspace is navigated via the magic `/dashboard/me` URL regardless of
  // the stored slug, so there's no UX cost to making it opaque. Users can
  // still rename from settings if they want a memorable handle.
  const baseSlug = `personal-${randomBytes(3).toString('hex')}`;
  const slug = await pickUniqueSlug(baseSlug);
  const name = user.name?.trim() || 'Personal';
  const trialEndsAt = new Date(Date.now() + PRICING.trialDays * 24 * 60 * 60 * 1000);

  await prisma.workspace.create({
    data: {
      slug,
      name,
      type: 'PERSONAL',
      ownerId: userId,
      softDeleteRetentionDays: DEFAULTS.softDeleteRetentionDays,
      members: { create: { userId, role: 'OWNER' } },
      subscription: { create: { status: 'TRIALING', trialEndsAt } },
    },
  });
}

export type CreateWorkspaceResult =
  | { ok: true; workspace: { id: string; slug: string } }
  | { ok: false; reason: 'slug-taken' | 'invalid-slug'; message: string };

export async function createTeamWorkspace(
  ownerId: string,
  input: WorkspaceCreateInput,
): Promise<CreateWorkspaceResult> {
  const slugCheck = validateWorkspaceSlug(input.slug);
  if (!slugCheck.ok) return { ok: false, reason: 'invalid-slug', message: slugCheck.reason };

  const existing = await prisma.workspace.findUnique({ where: { slug: input.slug } });
  if (existing) {
    return { ok: false, reason: 'slug-taken', message: 'That slug is already taken.' };
  }

  const trialEndsAt = new Date(Date.now() + PRICING.trialDays * 24 * 60 * 60 * 1000);
  const workspace = await prisma.workspace.create({
    data: {
      slug: input.slug,
      name: input.name,
      type: 'TEAM',
      ownerId,
      softDeleteRetentionDays: DEFAULTS.softDeleteRetentionDays,
      members: { create: { userId: ownerId, role: 'OWNER' } },
      subscription: { create: { status: 'TRIALING', trialEndsAt } },
    },
    select: { id: true, slug: true },
  });
  return { ok: true, workspace };
}

// Look up a workspace by slug, returning it only if the user is a member.
// The literal "me" resolves to the signed-in user's personal workspace,
// regardless of its stored slug.
// `include` allows callers to ask for extra relations (projects, subscription...).
export async function getWorkspaceForUser<TInclude extends Prisma.WorkspaceInclude>(
  slug: string,
  userId: string,
  include?: TInclude,
): Promise<Prisma.WorkspaceGetPayload<{ include: TInclude }> | null> {
  const where: Prisma.WorkspaceWhereInput =
    slug === PERSONAL_WORKSPACE_URL_SLUG
      ? { ownerId: userId, type: 'PERSONAL', deletedAt: null }
      : { slug, deletedAt: null, members: { some: { userId } } };
  const ws = await prisma.workspace.findFirst({
    where,
    include: include as Prisma.WorkspaceInclude,
  });
  return (ws as Prisma.WorkspaceGetPayload<{ include: TInclude }>) ?? null;
}
