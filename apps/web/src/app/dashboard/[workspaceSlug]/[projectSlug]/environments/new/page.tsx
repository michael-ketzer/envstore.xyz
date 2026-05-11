import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireSession } from '@/lib/auth-helpers';
import { getProjectForUser } from '@/lib/projects';
import { NewEnvironmentForm } from './new-env-form';

export const metadata: Metadata = {
  title: 'New environment — envstore',
};

export default async function NewEnvironmentPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const session = await requireSession();
  const { workspaceSlug, projectSlug } = await params;
  const project = await getProjectForUser(workspaceSlug, projectSlug, session.user.id, {});
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link
          href={`/dashboard/${workspaceSlug}/${projectSlug}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to {projectSlug}
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">New environment</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An environment holds the versioned, encrypted .env file for one deployment target. The
          CLI usually creates these on first push — this form is for setting one up ahead of time.
        </p>
      </div>
      <NewEnvironmentForm workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
    </div>
  );
}
