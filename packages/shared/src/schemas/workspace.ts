import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';

export const workspaceSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

export const workspaceNameSchema = z.string().min(1).max(LIMITS.nameMax).trim();

export const workspaceCreateSchema = z.object({
  name: workspaceNameSchema,
  slug: workspaceSlugSchema,
});

export const workspaceUpdateSchema = z.object({
  name: workspaceNameSchema.optional(),
  description: z.string().max(LIMITS.descriptionMax).nullable().optional(),
  softDeleteRetentionDays: z.number().int().min(0).max(365).optional(),
});

// Slug rename is its own schema — different role gate (OWNER only) and side
// effects (URLs change, envstore.json files referencing the old slug break).
export const workspaceRenameSlugSchema = z.object({
  slug: workspaceSlugSchema,
});

export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateSchema>;
export type WorkspaceRenameSlugInput = z.infer<typeof workspaceRenameSlugSchema>;

// ---- API responses (CLI consumers) ----

export const workspaceSummarySchema = z.object({
  id: z.string(),
  slug: workspaceSlugSchema,
  name: z.string(),
  type: z.enum(['PERSONAL', 'TEAM']),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

export const workspaceListResponseSchema = z.object({
  workspaces: z.array(workspaceSummarySchema),
});

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
