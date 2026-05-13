// POST /api/v1/link-codes/redeem
//
// Authenticated. Body: { code }. Returns { workspace, project } or a
// structured error. Workspace-membership gates redemption (no consumption,
// no expiry — codes are stable per project).

import { z } from 'zod';

import { apiError, authenticateBearer, requireUserAuth, unauthorized } from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';
import { redeemLinkCode } from '@/lib/project-link-codes-redeem';
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
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;

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

  const result = await redeemLinkCode({ code: parsed.data.code, userId: userAuth.user.id });
  if (!result.ok) {
    // Collapse "code doesn't exist" and "code exists but you're not a member"
    // into the same 404 + uniform message. Distinguishing the two is a
    // computationally-inert info leak given the 32^8 ≈ 10^12 code space + IP
    // rate limit, but the cleaner pattern is to deny existence to the caller.
    // Legit users who get this for a real code will check the code and ask
    // their workspace admin for an invite.
    return apiError(
      'Code not found, or you are not a member of its workspace.',
      404,
    );
  }

  await recordAudit({
    userId: userAuth.user.id,
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
    group: result.project.group,
  });
}
