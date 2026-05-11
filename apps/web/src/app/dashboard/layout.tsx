import Link from 'next/link';

import { Button, Logo } from '@envstore/ui';

import { signOut } from '@/lib/auth';
import { requireSession } from '@/lib/auth-helpers';

async function signOutAction() {
  'use server';
  await signOut({ redirectTo: '/' });
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" aria-label="envstore dashboard">
            <Logo />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/dashboard/account"
              className="text-muted-foreground hover:text-foreground"
              title="Account & CLI sessions"
            >
              {session.user.email}
            </Link>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">{children}</main>
    </div>
  );
}
