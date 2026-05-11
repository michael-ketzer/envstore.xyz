import type { Metadata } from 'next';
import Link from 'next/link';

import { PRICING } from '@envstore/shared';

import { requireSession } from '@/lib/auth-helpers';
import { NewWorkspaceForm } from './new-workspace-form';

export const metadata: Metadata = {
  title: 'New workspace — envstore',
};

export default async function NewWorkspacePage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to workspaces
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">New team workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Team workspaces have unlimited members. Each is $
          {(PRICING.monthlyCents / 100).toFixed(2)}/month after a {PRICING.trialDays}-day trial — no
          card required to start.
        </p>
      </div>
      <NewWorkspaceForm />
    </div>
  );
}
