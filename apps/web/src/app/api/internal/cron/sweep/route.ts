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

import { timingSafeEqual } from 'node:crypto';

import { apiError } from '@/lib/api-auth';
import { env } from '@/env';
import { runRetentionSweep } from '@/lib/retention-sweep';

export const dynamic = 'force-dynamic';

// Constant-time compare for the Authorization header. Plain `!==`
// short-circuits at the first mismatched byte; that's a network-noisy
// signal in practice but trivial to eliminate.
function safeBearerEq(received: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  if (received === null) return false;
  // Pad received to the expected length so timingSafeEqual doesn't throw
  // on a length mismatch (it requires equal-length buffers). The pad is
  // overwritten by a fresh comparison that we discard — the actual answer
  // comes from the equal-length compare AND the original length check.
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do a constant-time compare on a same-length pad so the path
    // taken doesn't leak the length-equality result.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!env.CRON_SECRET) {
    return apiError(
      'Cron is disabled: CRON_SECRET is not configured on this deployment.',
      503,
    );
  }

  const bearer = req.headers.get('authorization');
  if (!safeBearerEq(bearer, env.CRON_SECRET)) {
    return apiError('Unauthorized cron invocation.', 401);
  }

  const result = await runRetentionSweep();
  return Response.json({ ok: true, ...result });
}
