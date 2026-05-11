'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import { requestOtpAction, type LoginActionState } from './actions';

const initialState: LoginActionState = { error: null };

export function EmailOtpForm() {
  const [state, action, pending] = useActionState(requestOtpAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-foreground">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Send 6-digit code'}
      </Button>
      {state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
