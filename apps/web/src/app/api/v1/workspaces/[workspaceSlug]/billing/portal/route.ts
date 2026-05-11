// GET /api/v1/workspaces/[ws]/billing/portal
//
// Returns a one-time URL into Paddle's hosted customer portal so the user can
// update their card on file, view invoices, etc. Scoped to this workspace's
// subscription only — even though the same Customer may own subscriptions for
// multiple workspaces, the portal session is filtered to the one they asked
// about.

import { prisma } from '@envstore/db';

import { apiError } from '@/lib/api-auth';
import { auth } from '@/lib/auth';
import { BillingNotConfiguredError, createCustomerPortalSession } from '@/lib/paddle';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return apiError('Not authenticated.', 401);

  const { workspaceSlug } = await ctx.params;

  const workspace = await prisma.workspace.findFirst({
    where:
      workspaceSlug === 'me'
        ? { ownerId: session.user.id, type: 'PERSONAL', deletedAt: null }
        : {
            slug: workspaceSlug,
            deletedAt: null,
            ownerId: session.user.id,
          },
    select: {
      id: true,
      owner: { select: { paddleCustomerId: true } },
      subscription: { select: { paddleSubscriptionId: true } },
    },
  });
  if (!workspace) return apiError('Workspace not found.', 404);
  const customerId = workspace.owner.paddleCustomerId;
  const paddleSubscriptionId = workspace.subscription?.paddleSubscriptionId;
  if (!customerId || !paddleSubscriptionId) {
    return apiError(
      'No subscription yet. Start a subscription before opening the portal.',
      400,
    );
  }

  try {
    const { overviewUrl } = await createCustomerPortalSession(customerId, [
      paddleSubscriptionId,
    ]);
    return Response.json({ url: overviewUrl });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return apiError(err.message, 503);
    }
    throw err;
  }
}
