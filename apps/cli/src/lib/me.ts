// Shared shape of the `/api/v1/me` response used by multiple commands.

export type MeWorkspace = {
  slug: string;
  name: string;
  type: 'PERSONAL' | 'TEAM';
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
};

export type MeRecipient = {
  id: string;
  recipient: string;
  kind: 'AGE_X25519' | 'SSH_ED25519' | 'SSH_RSA';
  label: string;
};

export type MeResponse = {
  user: { id: string; email: string; name: string | null };
  workspaces: MeWorkspace[];
  recipients: MeRecipient[];
};
