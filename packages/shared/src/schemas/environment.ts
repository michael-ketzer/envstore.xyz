import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';

export const environmentSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

export const environmentCreateSchema = z.object({
  slug: environmentSlugSchema,
  name: z.string().min(1).max(LIMITS.nameMax).trim(),
});

export const environmentUpdateSchema = z.object({
  name: z.string().min(1).max(LIMITS.nameMax).trim().optional(),
});

export type EnvironmentCreateInput = z.infer<typeof environmentCreateSchema>;
export type EnvironmentUpdateInput = z.infer<typeof environmentUpdateSchema>;
