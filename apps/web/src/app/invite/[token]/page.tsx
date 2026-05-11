import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { prisma } from '@envstore/db';
import { sha256Hex } from '@envstore/crypto/hash';

import { auth } from '@/lib/auth';
import { AcceptButton } from './accept-button';

export const metadata: Metadata = {
  title: 'Workspace invite — envstore',
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tokenHash = await sha256Hex(token);
  const invite = await prisma.invite.findUnique({
    where: { tokenHash },
    include: {
      workspace: { select: { slug: true, name: true } },
      invitedBy: { select: { email: true, name: true } },
    },
  });

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  }

  if (!invite) {
    return (
      <Shell title="Invite not found">
        This invite link is invalid. Ask whoever sent it to send a new one.
      </Shell>
    );
  }
  if (invite.acceptedAt) {
    return (
      <Shell title="Already accepted">
        <p>This invite has already been used.</p>
        <p className="mt-4">
          <Link href="/dashboard" className="underline">
            Go to your dashboard
          </Link>
        </p>
      </Shell>
    );
  }
  if (invite.expiresAt < new Date()) {
    return (
      <Shell title="Invite expired">
        This invite expired on {invite.expiresAt.toLocaleDateString()}. Ask {invite.invitedBy.name ?? invite.invitedBy.email} to send a new one.
      </Shell>
    );
  }

  const emailMismatch =
    session.user.email?.toLowerCase() !== invite.email.toLowerCase();
  const inviterName = invite.invitedBy.name ?? invite.invitedBy.email;

  return (
    <Shell title="Join workspace">
      <p>
        <strong>{inviterName}</strong> invited you to join{' '}
        <strong>{invite.workspace.name}</strong> as a{' '}
        <span className="font-mono">{invite.role.toLowerCase()}</span>.
      </p>
      {emailMismatch ? (
        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          This invite was sent to <strong>{invite.email}</strong>, but you&rsquo;re signed in as{' '}
          <strong>{session.user.email}</strong>. Sign out and sign back in with the right email to
          accept.
        </div>
      ) : (
        <div className="mt-6">
          <AcceptButton token={token} />
        </div>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md space-y-6">
        <Link href="/" className="font-mono text-sm font-semibold">
          envstore
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="mt-4 text-sm text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}
