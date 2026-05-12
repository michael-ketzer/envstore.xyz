import { z } from 'zod';

import { LIMITS, RECIPIENT_KINDS } from '../constants';
import { noControlChars, safeDisplayString } from '../safe-string';

export const recipientRegisterSchema = z.object({
  // `recipient` is a public key string with strict structural validation
  // downstream (parseRecipient); we still reject control chars here as a
  // first-line defense.
  recipient: z
    .string()
    .trim()
    .min(10)
    .max(LIMITS.recipientMax)
    .refine(noControlChars, 'recipient must not contain control characters'),
  kind: z.enum(RECIPIENT_KINDS),
  // Labels are printed verbatim in CLI trust prompts — see safe-string.ts
  // for why control chars / ANSI escapes are refused.
  label: safeDisplayString(1, LIMITS.recipientLabelMax),
});

export const recipientUpdateSchema = z.object({
  label: safeDisplayString(1, LIMITS.recipientLabelMax),
});

export type RecipientRegisterInput = z.infer<typeof recipientRegisterSchema>;
export type RecipientUpdateInput = z.infer<typeof recipientUpdateSchema>;
