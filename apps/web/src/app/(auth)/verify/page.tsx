import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { VerifyForm } from './verify-form';

export const metadata: Metadata = {
  title: 'Verify — envstore',
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  if (!email) {
    redirect('/login');
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a 6-digit code to <strong className="text-foreground">{email}</strong>. It
          expires in 10 minutes.
        </p>
      </div>

      <VerifyForm email={email} />

      <p className="text-center text-xs text-muted-foreground">
        Didn't get it?{' '}
        <Link href="/login" className="underline">
          Try again
        </Link>
      </p>
    </div>
  );
}
