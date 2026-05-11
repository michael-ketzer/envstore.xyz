import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DEVICE_CODE_USER_CODE_REGEX } from '@envstore/shared';

import { auth } from '@/lib/auth';
import {
  getDeviceAuthorizationForReview,
  normalizeUserCode,
} from '@/lib/device-auth';
import { ApprovalButtons } from './approval-buttons';

export const metadata: Metadata = {
  title: 'Approve CLI sign-in — envstore',
};

type Status = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CONSUMED';

export default async function CliApprovalPage({
  params,
}: {
  params: Promise<{ userCode: string }>;
}) {
  const { userCode: rawCode } = await params;
  const code = normalizeUserCode(rawCode);
  if (!DEVICE_CODE_USER_CODE_REGEX.test(code)) {
    return (
      <Shell title="Invalid code">
        That code isn&rsquo;t shaped right. <Link href="/cli" className="underline">Try again</Link>.
      </Shell>
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/cli/${code}`)}`);
  }

  const authzn = await getDeviceAuthorizationForReview(code);
  if (!authzn) {
    return (
      <Shell title="Code not found">
        We couldn&rsquo;t find that code. Codes expire after 10 minutes.{' '}
        <Link href="/cli" className="underline">Try a fresh one</Link>.
      </Shell>
    );
  }

  const now = new Date();
  const status: Status =
    authzn.status === 'PENDING' && authzn.expiresAt < now
      ? 'EXPIRED'
      : (authzn.status as Status);
  const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;

  return (
    <Shell title="Approve CLI sign-in">
      <dl className="mt-6 space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono">{formatted}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Device</dt>
          <dd className="font-mono">{authzn.clientName ?? 'envstore-cli'}</dd>
        </div>
        {authzn.ipAddress ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">From</dt>
            <dd className="font-mono">{authzn.ipAddress}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{authzn.expiresAt.toLocaleString()}</dd>
        </div>
      </dl>

      {status === 'PENDING' ? (
        <>
          <p className="mt-6 text-sm text-muted-foreground">
            Approving signs the CLI in as <strong className="text-foreground">{session.user.email}</strong>.
            Cancel any time by running <code className="font-mono">envstore logout</code> from
            that machine, or from the dashboard&rsquo;s CLI sessions list.
          </p>
          <div className="mt-6">
            <ApprovalButtons userCode={code} />
          </div>
        </>
      ) : (
        <StatusPanel status={status} />
      )}
    </Shell>
  );
}

function StatusPanel({ status }: { status: Status }) {
  const message: Record<Status, { title: string; body: React.ReactNode }> = {
    PENDING: { title: '', body: null }, // handled above
    APPROVED: {
      title: 'Already approved',
      body: 'Return to your terminal — the CLI should pick the token up on its next poll.',
    },
    CONSUMED: {
      title: 'Token already delivered',
      body: "The CLI has already received the token for this code. If something went wrong, run `envstore login` again.",
    },
    DENIED: {
      title: 'Denied',
      body: 'You denied this request. The CLI will exit with an error.',
    },
    EXPIRED: {
      title: 'Expired',
      body: (
        <>
          The code timed out. Re-run <code className="font-mono">envstore login</code> for a new one.
        </>
      ),
    },
  };
  const m = message[status];
  return (
    <div className="mt-6 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <p className="font-medium text-foreground">{m.title}</p>
      <p className="mt-1 text-muted-foreground">{m.body}</p>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
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
        <div className="w-full max-w-md space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="text-sm text-muted-foreground">{children}</div>
        </div>
      </main>
    </div>
  );
}
