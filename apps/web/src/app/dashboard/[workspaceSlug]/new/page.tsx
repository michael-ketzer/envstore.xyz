import type { Metadata } from 'next';
import Link from 'next/link';

import { NewProjectForm } from './new-project-form';

export const metadata: Metadata = {
  title: 'New project — envstore',
};

export default async function NewProjectPage({
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
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">New project</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Usually one project per app or repo. Each project holds one or more environments
          (production, staging, dev…), and each environment has its own encrypted version history.
        </p>
      </div>
      <NewProjectForm workspaceSlug={workspaceSlug} />
    </div>
  );
}
