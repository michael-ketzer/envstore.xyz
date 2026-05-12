import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';
import { safeDisplayString } from '../safe-string';
import { projectGroupRefSchema, projectGroupSlugSchema } from './project-group';

export const projectSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

// Multi-line description: allow newlines, reject other C0/DEL control chars.
const projectDescriptionSchema = z
  .string()
  .max(LIMITS.descriptionMax)
  .refine(
    (s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s),
    'description must not contain control characters',
  );

export const projectCreateSchema = z.object({
  // Optional. Omit it and the server generates `<slugify(name)>-<random>`;
  // the CLI still passes one explicitly for the monorepo init flow.
  slug: projectSlugSchema.optional(),
  name: safeDisplayString(1, LIMITS.nameMax),
  description: projectDescriptionSchema.optional(),
  // Slug of the ProjectGroup to attach to. The server creates the group
  // on the fly if no row with this slug exists yet — that's how the CLI
  // monorepo init flow seeds groups without a separate API call.
  group: projectGroupSlugSchema.optional(),
});

export const projectUpdateSchema = z.object({
  name: safeDisplayString(1, LIMITS.nameMax).optional(),
  description: projectDescriptionSchema.nullable().optional(),
  // Same shape as create. Pass `null` to unassign the project from its
  // current group (it becomes standalone).
  group: projectGroupSlugSchema.nullable().optional(),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

// ---- API responses (CLI consumers) ----

export const projectSummarySchema = z.object({
  id: z.string(),
  slug: projectSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  group: projectGroupRefSchema.nullable(),
  environmentCount: z.number().int().nonnegative(),
});

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
