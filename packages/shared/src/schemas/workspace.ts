import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';
import { noControlChars, safeDisplayString } from '../safe-string';

export const workspaceSlugSchema = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid slug format');

export const workspaceNameSchema = safeDisplayString(1, LIMITS.nameMax);

export const workspaceCreateSchema = z.object({
  name: workspaceNameSchema,
  slug: workspaceSlugSchema,
});

export const workspaceUpdateSchema = z.object({
  name: workspaceNameSchema.optional(),
  // Descriptions can be longer than names but still flow through the same
  // terminal contexts (dashboard, CLI listings). Allow newlines via a more
  // permissive policy: reject NUL + DEL, allow LF/CR for multiline text.
  description: z
    .string()
    .max(LIMITS.descriptionMax)
    .refine(
      (s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s),
      'description must not contain control characters',
    )
    .nullable()
    .optional(),
  softDeleteRetentionDays: z.number().int().min(0).max(365).optional(),
});

export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateSchema>;

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
