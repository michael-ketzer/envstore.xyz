import { notFound } from 'next/navigation';

import { requireSession } from '@/lib/auth-helpers';
import { getWorkspaceForUser } from '@/lib/workspaces';

// Membership gate — any non-member sees 404, not a redirect, so we don't leak
// existence of arbitrary workspace slugs.
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug } = await params;
  const ws = await getWorkspaceForUser(workspaceSlug, session.user.id, {});
  if (!ws) notFound();
  return <>{children}</>;
}
