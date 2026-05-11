import { z } from 'zod';

import { LIMITS, RECIPIENT_KINDS } from '../constants';

export const recipientRegisterSchema = z.object({
  recipient: z.string().trim().min(10).max(LIMITS.recipientMax),
  kind: z.enum(RECIPIENT_KINDS),
  label: z.string().min(1).max(LIMITS.recipientLabelMax),
});

export const recipientUpdateSchema = z.object({
  label: z.string().min(1).max(LIMITS.recipientLabelMax),
});

export type RecipientRegisterInput = z.infer<typeof recipientRegisterSchema>;
export type RecipientUpdateInput = z.infer<typeof recipientUpdateSchema>;
