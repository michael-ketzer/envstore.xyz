import type { Metadata } from 'next';
import Link from 'next/link';

import { NewGroupForm } from './new-group-form';

export const metadata: Metadata = {
  title: 'New group — envstore',
};

export default async function NewGroupPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link
          href={`/dashboard/${workspaceSlug}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to {workspaceSlug}
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">New group</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A group clusters related projects on the dashboard — typically all the apps of one
          monorepo. Pure UX: projects in a group still have independent environments, push/pull
          tokens, and settings.
        </p>
      </div>
      <NewGroupForm workspaceSlug={workspaceSlug} />
    </div>
  );
}
