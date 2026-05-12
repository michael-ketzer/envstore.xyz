'use client';

import { useActionState, useState } from 'react';

import { Button } from '@envstore/ui';

import {
  approveAction,
  denyAction,
  type CliApprovalState,
} from './actions';

const initial: CliApprovalState = { error: null, approved: false };

// Normalize the user's typed code the same way the server does:
// strip whitespace and hyphens, uppercase. Lets "abcd-efgh", "ABCD EFGH",
// and "abcdefgh" all match.
function normalize(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

// Force a deliberate "look at your terminal" step. The URL fragment we
// arrived from carries the code (e.g. /cli/ABCD-EFGH); if a phishing link
// just dropped a user here, clicking Approve must still require them to
// re-type the exact code their CLI printed. The match is checked locally
// (to enable the button) AND server-side in the action (so a tampered
// client can't bypass it).
export function ApprovalButtons({ userCode }: { userCode: string }) {
  const approveBound = approveAction.bind(null, userCode);
  const denyBound = denyAction.bind(null, userCode);
  const [approveState, approveFn, approvePending] = useActionState(approveBound, initial);
  const [denyState, denyFn, denyPending] = useActionState(denyBound, initial);
  const [typedCode, setTypedCode] = useState('');

  const expected = normalize(userCode);
  const typedNormalized = normalize(typedCode);
  const codeMatches = typedNormalized.length > 0 && typedNormalized === expected;

  if (approveState.approved) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium text-foreground">Approved.</p>
        <p className="mt-1 text-muted-foreground">
          Return to your terminal — the CLI should be signed in within a few seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="confirm-code" className="block text-sm font-medium text-foreground">
          Re-type the code from your terminal to confirm
        </label>
        <input
          id="confirm-code"
          name="confirm-code"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          value={typedCode}
          onChange={(e) => setTypedCode(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-ring"
          aria-describedby="confirm-code-help"
        />
        <p id="confirm-code-help" className="text-xs text-muted-foreground">
          The code is shown in the terminal where you ran <code className="font-mono">envstore login</code>.
          If you didn&rsquo;t start this, click Deny.
        </p>
      </div>

      <div className="flex gap-3">
        <form action={approveFn}>
          <input type="hidden" name="confirmCode" value={typedCode} />
          <Button type="submit" disabled={approvePending || denyPending || !codeMatches}>
            {approvePending ? 'Approving…' : 'Approve & sign in'}
          </Button>
        </form>
        <form action={denyFn}>
          <Button type="submit" variant="outline" disabled={approvePending || denyPending}>
            {denyPending ? 'Denying…' : 'Deny'}
          </Button>
        </form>
      </div>
      {approveState.error ? (
        <p className="text-sm text-destructive">{approveState.error}</p>
      ) : null}
      {denyState.error ? <p className="text-sm text-destructive">{denyState.error}</p> : null}
    </div>
  );
}
