import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';

export const projectSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

export const projectCreateSchema = z.object({
  slug: projectSlugSchema,
  name: z.string().min(1).max(LIMITS.nameMax).trim(),
  description: z.string().max(LIMITS.descriptionMax).optional(),
});

export const projectUpdateSchema = z.object({
  name: z.string().min(1).max(LIMITS.nameMax).trim().optional(),
  description: z.string().max(LIMITS.descriptionMax).nullable().optional(),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

// ---- API responses (CLI consumers) ----

export const projectSummarySchema = z.object({
  id: z.string(),
  slug: projectSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  environmentCount: z.number().int().nonnegative(),
});

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
