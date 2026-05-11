import type { Metadata } from 'next';

import { Button } from '@envstore/ui';

import { features } from '@/env';
import { oauthSignInAction } from './actions';
import { EmailOtpForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in — envstore',
};

export default function LoginPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to envstore</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          New here? Sign in and we'll create your account automatically.
        </p>
      </div>

      {features.emailOtp ? (
        <EmailOtpForm />
      ) : (
        <p className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Email sign-in is not configured on this instance.
        </p>
      )}

      {(features.githubAuth || features.googleAuth) && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or continue with</span>
            </div>
          </div>

          <div className="grid gap-2">
            {features.githubAuth && (
              <form action={oauthSignInAction}>
                <input type="hidden" name="provider" value="github" />
                <Button type="submit" variant="outline" className="w-full">
                  Continue with GitHub
                </Button>
              </form>
            )}
            {features.googleAuth && (
              <form action={oauthSignInAction}>
                <input type="hidden" name="provider" value="google" />
                <Button type="submit" variant="outline" className="w-full">
                  Continue with Google
                </Button>
              </form>
            )}
          </div>
        </>
      )}

      <p className="text-center text-xs text-muted-foreground">
        By signing in you agree to the{' '}
        <a href="/terms" className="underline">
          terms
        </a>{' '}
        and{' '}
        <a href="/privacy" className="underline">
          privacy policy
        </a>
        .
      </p>
    </div>
  );
}
