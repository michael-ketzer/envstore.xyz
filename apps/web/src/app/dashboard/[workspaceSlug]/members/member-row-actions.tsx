'use client';

import { useActionState } from 'react';

import { Button } from '@envstore/ui';

import {
  changeRoleAction,
  removeMemberAction,
  revokeInviteAction,
  type MembersActionState,
} from './actions';

const initial: MembersActionState = { ok: false, error: null };

export function RemoveMemberButton({
  workspaceSlug,
  userId,
}: {
  workspaceSlug: string;
  userId: string;
}) {
  const boundAction = removeMemberAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-destructive"
      >
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      {state.error ? <p className="mt-1 text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function RoleSelect({
  workspaceSlug,
  userId,
  currentRole,
}: {
  workspaceSlug: string;
  userId: string;
  currentRole: 'ADMIN' | 'MEMBER';
}) {
  const boundAction = changeRoleAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        disabled={pending}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
      >
        <option value="MEMBER">Member</option>
        <option value="ADMIN">Admin</option>
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function RevokeInviteButton({
  workspaceSlug,
  inviteId,
}: {
  workspaceSlug: string;
  inviteId: string;
}) {
  const boundAction = revokeInviteAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="inviteId" value={inviteId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke'}
      </Button>
      {state.error ? <p className="mt-1 text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
