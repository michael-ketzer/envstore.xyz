'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { features } from '@/env';
import { requireSession } from '@/lib/auth-helpers';
import { applicationAdmin, type ApplicationAction } from '@/lib/managed-keys/applications';
import { audited, parseId, throttle, type Audit } from '@/lib/managed-keys/common';
import { applicationSchema } from '@/lib/managed-keys/contracts';
import { ManagedKeyError } from '@/lib/managed-keys/http';
import { getWorkspaceMembershipWithRole } from '@/lib/workspace-roles';

export type ApplicationActionState = {
  error: string | null;
  created?: { name: string; token?: string; authMode: 'token' | 'vercel' };
};
export type RevokeApplicationState = { error: string | null; revoked: boolean };

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

async function manageApplication(
  workspaceSlug: string,
  userId: string,
  action: ApplicationAction,
  body?: unknown,
  rawId?: string,
) {
  const membership = await getWorkspaceMembershipWithRole(workspaceSlug, userId, 'ADMIN');
  if (!membership) {
    throw new ManagedKeyError(
      403,
      'Only workspace admins and owners can manage encryption applications.',
    );
  }
  if (!features.managedKeys) {
    throw new ManagedKeyError(
      503,
      'Application encryption is not configured on this installation.',
    );
  }
  const id = rawId ? parseId(rawId) : undefined;
  if (action === 'application.revoke' && !id) {
    throw new ManagedKeyError(400, 'Invalid application identifier.');
  }
  const actor = { workspaceId: membership.workspaceId, userId };
  throttle(userId);
  const audit: Audit = { ...actor, operation: action, applicationId: id };
  return audited(audit, () => applicationAdmin(body, actor, action, audit, id));
}

function errorMessage(error: unknown): string {
  return error instanceof ManagedKeyError
    ? error.message
    : 'Application encryption is temporarily unavailable. Please try again.';
}

export async function createApplicationAction(
  workspaceSlug: string,
  _previous: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const session = await requireSession();
  const authMode = field(formData, 'authMode');
  if (authMode !== 'token' && authMode !== 'vercel') {
    return { error: 'Choose an authentication method.' };
  }
  const input = applicationSchema.safeParse({
    name: field(formData, 'name'),
    environment: field(formData, 'environment'),
    purpose: field(formData, 'purpose'),
    keyName: field(formData, 'keyName'),
    maxTenants: Number(field(formData, 'maxTenants')),
    ...(authMode === 'token'
      ? { token: { expiresInDays: Number(field(formData, 'expiresInDays')) } }
      : {
          vercel: {
            teamId: field(formData, 'vercelTeamId'),
            projectId: field(formData, 'vercelProjectId'),
            environment: field(formData, 'vercelEnvironment'),
          },
        }),
  });
  if (!input.success) {
    return {
      error: 'Check the application identifiers, tenant limit, and authentication settings.',
    };
  }
  try {
    const response = await manageApplication(
      workspaceSlug,
      session.user.id,
      'application.register',
      input.data,
    );
    const result = (await response.json()) as { application: { name: string }; token?: string };
    revalidatePath(`/dashboard/${workspaceSlug}/settings/applications`);
    return {
      error: null,
      created: {
        name: result.application.name,
        authMode,
        ...(result.token ? { token: result.token } : {}),
      },
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function revokeApplicationAction(
  workspaceSlug: string,
  applicationId: string,
  _previous: RevokeApplicationState,
  _formData: FormData,
): Promise<RevokeApplicationState> {
  const session = await requireSession();
  try {
    await manageApplication(
      workspaceSlug,
      session.user.id,
      'application.revoke',
      undefined,
      applicationId,
    );
    revalidatePath(`/dashboard/${workspaceSlug}/settings/applications`);
    return { error: null, revoked: true };
  } catch (error) {
    return { error: errorMessage(error), revoked: false };
  }
}
