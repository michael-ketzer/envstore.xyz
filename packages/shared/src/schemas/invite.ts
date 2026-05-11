import { z } from 'zod';

import { WORKSPACE_ROLES } from '../constants';
import { emailSchema } from './auth';

export const inviteCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(WORKSPACE_ROLES).default('MEMBER'),
});

export const inviteAcceptSchema = z.object({
  token: z.string().min(20).max(120),
});

export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
export type InviteAcceptInput = z.infer<typeof inviteAcceptSchema>;
