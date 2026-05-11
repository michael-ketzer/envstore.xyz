import type { Metadata } from 'next';
import Link from 'next/link';

import { Button, Input, Label } from '@envstore/ui';
import { DEVICE_CODE_USER_CODE_LENGTH } from '@envstore/shared';

import { redirectToCodeAction } from './actions';

export const metadata: Metadata = {
  title: 'Connect a device — envstore',
};

export default function CliCodePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-mono text-sm font-semibold">
            envstore
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Connect the CLI</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the code shown in your terminal. It looks like{' '}
              <code className="font-mono">ABCD-EFGH</code>.
            </p>
          </div>
          <form action={redirectToCodeAction} className="space-y-3">
            <Label htmlFor="code">One-time code</Label>
            <Input
              id="code"
              name="code"
              required
              autoFocus
              autoComplete="off"
              inputMode="text"
              spellCheck={false}
              maxLength={DEVICE_CODE_USER_CODE_LENGTH + 4}
              placeholder="ABCD-EFGH"
              className="text-center font-mono text-lg tracking-[0.3em] uppercase"
            />
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
