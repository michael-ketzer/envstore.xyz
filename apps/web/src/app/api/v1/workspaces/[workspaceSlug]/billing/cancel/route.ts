// POST /api/v1/workspaces/[ws]/billing/cancel
//
// Cancels the workspace's Paddle subscription at the END of the current
// billing period. The user keeps the access they already paid for; Paddle
// fires `subscription.canceled` once the period elapses and our webhook
// flips the workspace into the read-only grace window.

import { prisma } from '@envstore/db';

import { apiError } from '@/lib/api-auth';
import { auth } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { BillingNotConfiguredError, cancelSubscriptionAtPeriodEnd } from '@/lib/paddle';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return apiError('Not authenticated.', 401);

  const { workspaceSlug } = await ctx.params;

  const workspace = await prisma.workspace.findFirst({
    where: {
      slug: workspaceSlug,
      deletedAt: null,
      ownerId: session.user.id,
    },
    select: {
      id: true,
      type: true,
      subscription: { select: { paddleSubscriptionId: true } },
    },
  });
  if (!workspace) return apiError('Workspace not found.', 404);
  if (workspace.type === 'PERSONAL') {
    return apiError('Personal workspaces are free — nothing to cancel.', 400);
  }
  const paddleSubscriptionId = workspace.subscription?.paddleSubscriptionId;
  if (!paddleSubscriptionId) {
    return apiError(
      'No active subscription on this workspace. Trials end automatically.',
      400,
    );
  }

  try {
    await cancelSubscriptionAtPeriodEnd(paddleSubscriptionId);
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return apiError(err.message, 503);
    }
    throw err;
  }

  await recordAudit({
    workspaceId: workspace.id,
    userId: session.user.id,
    action: 'billing.cancel_requested',
    resourceType: 'subscription',
    resourceId: paddleSubscriptionId,
  });

  return Response.json({ ok: true });
}
