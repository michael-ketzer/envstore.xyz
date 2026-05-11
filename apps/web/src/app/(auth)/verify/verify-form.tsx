'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { verifyOtpAction, type VerifyActionState } from './actions';

const initialState: VerifyActionState = { error: null };

export function VerifyForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(verifyOtpAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      <label className="block">
        <span className="text-sm font-medium text-foreground">6-digit code</span>
        <input
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          placeholder="000000"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.5em] shadow-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Verifying…' : 'Verify and sign in'}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
