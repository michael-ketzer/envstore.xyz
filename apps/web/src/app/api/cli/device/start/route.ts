import { z } from 'zod';

import { apiError, pickIp } from '@/lib/api-auth';
import { clientEnv } from '@/env.client';
import { startDeviceAuthorization } from '@/lib/device-auth';
import { rateLimitByIp, tooManyRequests } from '@/lib/rate-limit';
import { noControlChars } from '@envstore/shared';

const startSchema = z.object({
  // Rendered on /cli/<userCode> as the "Device:" line. Refuse control chars
  // so an attacker can't paint a fake row over the trusted IP/device-name
  // panel that the approving user is supposed to verify.
  clientName: z
    .string()
    .min(1)
    .max(80)
    .refine(noControlChars, 'clientName must not contain control characters')
    .optional(),
});

export async function POST(req: Request) {
  // Rate limit BEFORE parsing — keeps DB writes bounded even for malformed input.
  // 20 starts/hour/IP is plenty for legit users (typical: 1-2 per device).
  const rl = await rateLimitByIp('device-start', { limit: 20, windowSec: 3600 });
  if (!rl.success) return tooManyRequests(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid body.', 400);
  }
  const ip = await pickIp();
  const started = await startDeviceAuthorization({
    clientName: parsed.data.clientName ?? 'envstore-cli',
    ipAddress: ip,
  });

  const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return Response.json({
    deviceCode: started.deviceCode,
    userCode: started.formattedUserCode,
    verificationUri: `${base}/cli`,
    verificationUriComplete: `${base}/cli/${started.userCode}`,
    expiresIn: started.expiresIn,
    interval: started.interval,
  });
}
