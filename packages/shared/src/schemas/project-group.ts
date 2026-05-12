import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';
import { safeDisplayString } from '../safe-string';

export const projectGroupSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

const groupDescriptionSchema = z
  .string()
  .max(LIMITS.descriptionMax)
  .refine(
    (s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s),
    'description must not contain control characters',
  );

export const projectGroupCreateSchema = z.object({
  // Optional. Server generates `<slugify(name)>-<random>` when omitted.
  slug: projectGroupSlugSchema.optional(),
  name: safeDisplayString(1, LIMITS.nameMax),
  description: groupDescriptionSchema.optional(),
});

export const projectGroupUpdateSchema = z.object({
  name: safeDisplayString(1, LIMITS.nameMax).optional(),
  description: groupDescriptionSchema.nullable().optional(),
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
