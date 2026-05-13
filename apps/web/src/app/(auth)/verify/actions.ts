'use server';

import { AuthError } from 'next-auth';

import { otpVerifySchema } from '@envstore/shared';

import { signIn } from '@/lib/auth';
import { rateLimitByIp } from '@/lib/rate-limit';

export type VerifyActionState = { error: string | null };

export async function verifyOtpAction(
  _: VerifyActionState,
  formData: FormData,
): Promise<VerifyActionState> {
  // Per-IP cap on OTP verification submissions. The per-row `attempts` counter
  // (5 tries → token burned) handles brute force against a single code; this
  // bounds an attacker who cycles through fresh codes from one origin. 30 per
  // 10 minutes comfortably covers a fumble-fingered legit retry without
  // giving an attacker a meaningful budget.
  const rl = await rateLimitByIp('otp-verify', { limit: 30, windowSec: 600 });
  if (!rl.success) {
    return { error: 'Too many attempts. Please wait a moment before trying again.' };
  }

  const parsed = otpVerifySchema.safeParse({
    email: formData.get('email'),
    code: formData.get('code'),
  });
  if (!parsed.success) {
    return { error: 'Enter the 6-digit code from your email.' };
  }
  try {
    await signIn('email-otp', {
      email: parsed.data.email,
      code: parsed.data.code,
      redirectTo: '/dashboard',
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: 'That code didn’t work. It may have expired — request a new one.' };
    }
    // Auth.js uses `redirect()` under the hood on success; rethrow to let Next.js handle.
    throw err;
  }
  // Unreachable — signIn either throws AuthError or redirects.
  return { error: null };
}
