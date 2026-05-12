// GET /api/internal/cron/sweep — hard-delete the soft-deleted entities past
// retention. Idempotent; safe to invoke on a frequent schedule.
//
// Auth: `Authorization: Bearer $CRON_SECRET` only. Vercel Cron jobs receive
// this header automatically when CRON_SECRET is set as a project env var
// (their current recommended pattern), and self-hosted deploys can hit the
// route with the same header. We deliberately do NOT short-circuit on
// `x-vercel-cron: 1` — that header is only forge-resistant on Vercel's edge,
// so trusting it would silently fail open on every other host. If
// CRON_SECRET is unset we hard-refuse to run — a misconfigured deployment
// must not delete anything.

import { apiError } from '@/lib/api-auth';
import { env } from '@/env';
import { runRetentionSweep } from '@/lib/retention-sweep';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!env.CRON_SECRET) {
    return apiError(
      'Cron is disabled: CRON_SECRET is not configured on this deployment.',
      503,
    );
  }

  const bearer = req.headers.get('authorization');
  if (bearer !== `Bearer ${env.CRON_SECRET}`) {
    return apiError('Unauthorized cron invocation.', 401);
  }

  const result = await runRetentionSweep();
  return Response.json({ ok: true, ...result });
}
