'use server';

import { redirect } from 'next/navigation';

import { DEVICE_CODE_USER_CODE_REGEX } from '@envstore/shared';

import { normalizeUserCode } from '@/lib/device-auth';

export async function redirectToCodeAction(formData: FormData): Promise<void> {
  const raw = String(formData.get('code') ?? '');
  const normalized = normalizeUserCode(raw);
  if (!DEVICE_CODE_USER_CODE_REGEX.test(normalized)) {
    redirect(`/cli?err=invalid`);
  }
  redirect(`/cli/${normalized}`);
}
