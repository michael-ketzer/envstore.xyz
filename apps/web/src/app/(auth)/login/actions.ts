'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { otpRequestSchema } from '@envstore/shared';

import { signIn } from '@/lib/auth';
import { requestOtp } from '@/lib/auth-otp';
import { features } from '@/env';

export type LoginActionState = { error: string | null };

export async function requestOtpAction(
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  if (!features.emailOtp) {
    return { error: 'Email sign-in isn’t available on this instance.' };
  }
  const parsed = otpRequestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: 'Please enter a valid email address.' };
  }
  const result = await requestOtp(parsed.data.email);
  if (!result.ok) {
    if (result.reason === 'rate-limited') {
      return { error: 'Please wait a moment before requesting another code.' };
    }
    return { error: 'Could not send the code. Try again.' };
  }
  redirect(`/verify?email=${encodeURIComponent(parsed.data.email)}`);
}

const oauthSchema = z.object({ provider: z.enum(['github', 'google']) });

export async function oauthSignInAction(formData: FormData): Promise<void> {
  const parsed = oauthSchema.safeParse({ provider: formData.get('provider') });
  if (!parsed.success) return;
  // signIn throws a redirect — never returns.
  await signIn(parsed.data.provider, { redirectTo: '/dashboard' });
}
