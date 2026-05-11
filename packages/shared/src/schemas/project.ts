import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';

export const projectSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

// Optional folder name for grouping related projects (e.g. all apps under a
// single monorepo). Pure dashboard concern; free-form text with the same
// length/format constraints as a slug so it can render cleanly in a path.
export const projectGroupSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax);

export const projectCreateSchema = z.object({
  slug: projectSlugSchema,
  name: z.string().min(1).max(LIMITS.nameMax).trim(),
  description: z.string().max(LIMITS.descriptionMax).optional(),
  group: projectGroupSchema.optional(),
});

export const projectUpdateSchema = z.object({
  name: z.string().min(1).max(LIMITS.nameMax).trim().optional(),
  description: z.string().max(LIMITS.descriptionMax).nullable().optional(),
  group: projectGroupSchema.nullable().optional(),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

// ---- API responses (CLI consumers) ----

export const projectSummarySchema = z.object({
  id: z.string(),
  slug: projectSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  group: z.string().nullable(),
  environmentCount: z.number().int().nonnegative(),
});

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
