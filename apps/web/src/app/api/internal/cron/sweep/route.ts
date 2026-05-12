// GET /api/internal/cron/sweep — hard-delete the soft-deleted entities past
// retention. Idempotent; safe to invoke on a frequent schedule.
//
// Auth: either Vercel Cron (sets `x-vercel-cron: 1` on its own invocations of
// declared cron paths) or `Authorization: Bearer $CRON_SECRET`. Anything else
// returns 401 so the route can't be triggered by a casual GET. If CRON_SECRET
// is unset we hard-refuse to run — a misconfigured deployment must not delete
// anything.

import { headers } from 'next/headers';

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

  const h = await headers();
  const vercelCron = h.get('x-vercel-cron') === '1';
  const bearer = req.headers.get('authorization');
  const matchesBearer = bearer === `Bearer ${env.CRON_SECRET}`;

  if (!vercelCron && !matchesBearer) {
    return apiError('Unauthorized cron invocation.', 401);
  }

  const result = await runRetentionSweep();
  return Response.json({ ok: true, ...result });
}
