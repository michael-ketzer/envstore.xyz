'use client';

import { useActionState } from 'react';

import { Button, Input, Label } from '@envstore/ui';

import { inviteMemberAction, type MembersActionState } from './actions';

const initial: MembersActionState = { ok: false, error: null };

export function InviteForm({
  workspaceSlug,
  canInviteAdmins,
}: {
  workspaceSlug: string;
  canInviteAdmins: boolean;
}) {
  const boundAction = inviteMemberAction.bind(null, workspaceSlug);
  const [state, action, pending] = useActionState(boundAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="alice@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            defaultValue="MEMBER"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="MEMBER">Member</option>
            {canInviteAdmins ? <option value="ADMIN">Admin</option> : null}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.ok && state.info ? (
          <p className="text-sm text-muted-foreground">{state.info}</p>
        ) : null}
      </div>
    </form>
  );
}
