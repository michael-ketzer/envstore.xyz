import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';

export const projectGroupSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

export const projectGroupCreateSchema = z.object({
  // Optional. Server generates `<slugify(name)>-<random>` when omitted.
  slug: projectGroupSlugSchema.optional(),
  name: z.string().min(1).max(LIMITS.nameMax).trim(),
  description: z.string().max(LIMITS.descriptionMax).optional(),
});

export const projectGroupUpdateSchema = z.object({
  name: z.string().min(1).max(LIMITS.nameMax).trim().optional(),
  description: z.string().max(LIMITS.descriptionMax).nullable().optional(),
});

export type ProjectGroupCreateInput = z.infer<typeof projectGroupCreateSchema>;
export type ProjectGroupUpdateInput = z.infer<typeof projectGroupUpdateSchema>;

// ---- API responses ----

export const projectGroupSummarySchema = z.object({
  id: z.string(),
  slug: projectGroupSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  projectCount: z.number().int().nonnegative(),
});

export const projectGroupListResponseSchema = z.object({
  groups: z.array(projectGroupSummarySchema),
});

export type ProjectGroupSummary = z.infer<typeof projectGroupSummarySchema>;
export type ProjectGroupListResponse = z.infer<typeof projectGroupListResponseSchema>;

// The shape a Project response uses to describe its group: just enough for
// links and display, never the full group payload.
export const projectGroupRefSchema = z.object({
  slug: projectGroupSlugSchema,
  name: z.string(),
});

export type ProjectGroupRef = z.infer<typeof projectGroupRefSchema>;
