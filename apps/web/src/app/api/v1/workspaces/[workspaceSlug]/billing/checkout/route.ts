// POST /api/v1/workspaces/[ws]/billing/checkout
//
// Called from the dashboard (browser session — not the CLI bearer flow) when
// the workspace owner clicks "Subscribe". Creates a Paddle Transaction and
// returns its ID; the frontend then opens Paddle.js's inline overlay with
// that ID. The transaction is tagged with `customData.workspaceId` so the
// webhook can bind the resulting subscription to the right workspace.

import { prisma } from '@envstore/db';

import { apiError } from '@/lib/api-auth';
import { auth } from '@/lib/auth';
import {
  BillingNotConfiguredError,
  createWorkspaceCheckout,
  ensurePaddleCustomer,
} from '@/lib/paddle';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return apiError('Not authenticated.', 401);

  const { workspaceSlug } = await ctx.params;

  // Owner-only: only the workspace owner can start a checkout. Members
  // shouldn't be able to put their employer's card on file.
  // The `me` shortcut resolves to the caller's personal workspace — billing
  // applies to personal workspaces too (same trial + $1.99/mo terms as team).
  const workspace = await prisma.workspace.findFirst({
    where:
      workspaceSlug === 'me'
        ? { ownerId: session.user.id, type: 'PERSONAL', deletedAt: null }
        : {
            slug: workspaceSlug,
            deletedAt: null,
            ownerId: session.user.id,
          },
    select: { id: true },
  });
  if (!workspace) return apiError('Workspace not found.', 404);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, paddleCustomerId: true },
  });
  if (!user) return apiError('User not found.', 404);

  try {
    const customerId = await ensurePaddleCustomer(user);
    const { transactionId } = await createWorkspaceCheckout({
      workspaceId: workspace.id,
      customerId,
    });
    return Response.json({ transactionId, customerId });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return apiError(err.message, 503);
    }
    throw err;
  }
}
