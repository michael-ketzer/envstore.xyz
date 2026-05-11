import { z } from 'zod';

import { apiError } from '@/lib/api-auth';
import { pollDeviceAuthorization } from '@/lib/device-auth';
import { rateLimitByIp, tooManyRequests } from '@/lib/rate-limit';

const pollSchema = z.object({
  deviceCode: z.string().min(20).max(120),
});

export async function POST(req: Request) {
  // Outer IP-level cap on top of the per-authorization slow_down logic. A CLI
  // polling every 5s does ~12/min; 120/min/IP comfortably handles concurrent
  // CLI logins from one user/network without unfairly throttling them.
  const rl = await rateLimitByIp('device-poll', { limit: 120, windowSec: 60 });
  if (!rl.success) return tooManyRequests(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = pollSchema.safeParse(body);
  if (!parsed.success) return apiError('Invalid body.', 400);

  const outcome = await pollDeviceAuthorization(parsed.data.deviceCode);
  switch (outcome.kind) {
    case 'pending':
      return Response.json({ status: 'pending' });
    case 'slow_down':
      return Response.json({ status: 'slow_down', interval: outcome.interval });
    case 'approved':
      return Response.json({ status: 'approved', token: outcome.token });
    case 'denied':
      return Response.json({ status: 'denied' });
    case 'expired':
      return Response.json({ status: 'expired' });
  }
}
