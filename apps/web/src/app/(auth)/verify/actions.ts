'use server';

import { AuthError } from 'next-auth';

import { otpVerifySchema } from '@envstore/shared';

import { signIn } from '@/lib/auth';

export type VerifyActionState = { error: string | null };

export async function verifyOtpAction(
  _: VerifyActionState,
  formData: FormData,
): Promise<VerifyActionState> {
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
