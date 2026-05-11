// POST /api/v1/link-codes/redeem
//
// Authenticated. Body: { code }. Returns { workspace, project } or a
// structured error. Workspace-membership gates redemption (no consumption,
// no expiry — codes are stable per project).

import { z } from 'zod';

import { apiError, authenticateBearer, unauthorized } from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { redeemLinkCode } from '@/lib/project-link-codes';
import { rateLimitByIp, tooManyRequests } from '@/lib/rate-limit';

const bodySchema = z.object({
  code: z.string().min(4).max(40),
});

export async function POST(req: Request) {
  // Pre-auth rate limit so brute-force attempts can't probe arbitrary 8-char
  // codes against the DB unbounded. Search-space (32^8 ≈ 10^12) is already
  // infeasible to brute force, but this keeps log noise and DB load sane.
  const rl = await rateLimitByIp('link-redeem', { limit: 20, windowSec: 60 });
  if (!rl.success) return tooManyRequests(rl.retryAfterSec);

  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  const result = await redeemLinkCode({ code: parsed.data.code, userId: auth.user.id });
  if (!result.ok) {
    const status = result.reason === 'not-found' ? 404 : 403;
    return apiError(result.message, status);
  }

  await recordAudit({
    userId: auth.user.id,
    action: 'invite.accept',
    resourceType: 'projectLinkCode',
    metadata: {
      via: 'cli',
      workspace: result.workspace.slug,
      project: result.project.slug,
    },
  });

  return Response.json({
    workspace: result.workspace.slug,
    project: result.project.slug,
  });
}
