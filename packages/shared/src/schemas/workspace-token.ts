import { z } from 'zod';

import { LIMITS, SLUG_REGEX } from '../constants';

// Bearer prefix lets leaked tokens be greppable by GitGuardian / TruffleHog
// patterns and visually distinguishes service tokens from user CLI tokens.
export const WORKSPACE_TOKEN_PREFIX = 'eswtok_';
// 32 random bytes encoded base32 (no padding) = 52 chars. Plus prefix.
export const WORKSPACE_TOKEN_LENGTH = WORKSPACE_TOKEN_PREFIX.length + 52;

// Public age recipient. Real validation happens server-side via the same
// helpers the user-identity flow uses; here we just bound the size so
// pathological inputs don't reach the DB.
const recipientSchema = z.string().min(20).max(500);

const projectSlugInToken = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(SLUG_REGEX, 'Invalid project slug');

export const workspaceTokenCreateSchema = z.object({
  name: z.string().min(1).max(LIMITS.nameMax).trim(),
  // Public half of an age keypair the CLI generated locally. Server never
  // sees the private key — preserves zero-knowledge.
  recipient: recipientSchema,
  // Optional expiry in days from now. Server caps at a max and defaults
  // when omitted; see lib/workspace-tokens.ts.
  expiresInDays: z.number().int().min(1).max(365).optional(),
  // Optional project-scope allowlist (slugs). Omitted or empty array =
  // token authorizes every project in the workspace. Populated = strict
  // allowlist; server resolves slugs to IDs and stores those.
  projects: z.array(projectSlugInToken).max(50).optional(),
});

export type WorkspaceTokenCreateInput = z.infer<typeof workspaceTokenCreateSchema>;

// ---- API responses ----

// Summary shown in the list view. Never includes the bearer or its hash —
// the bearer is only ever returned once, at creation.
export const workspaceTokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  recipient: z.string(),
  scopes: z.array(z.string()),
  // Slugs of the projects the token is restricted to. Empty array = no
  // restriction (workspace-wide). The server resolves stored project IDs
  // back to slugs for display so a token survives slug renames.
  scopedProjects: z.array(z.object({ slug: z.string(), name: z.string() })),
  expiresAt: z.string().nullable(), // ISO
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  createdByEmail: z.string().nullable(),
});

export const workspaceTokenListResponseSchema = z.object({
  tokens: z.array(workspaceTokenSummarySchema),
});

// Returned ONCE on POST. The bearer is shown to the caller and never again.
export const workspaceTokenCreateResponseSchema = workspaceTokenSummarySchema.extend({
  token: z.string(),
});

export type WorkspaceTokenSummary = z.infer<typeof workspaceTokenSummarySchema>;
export type WorkspaceTokenListResponse = z.infer<typeof workspaceTokenListResponseSchema>;
export type WorkspaceTokenCreateResponse = z.infer<typeof workspaceTokenCreateResponseSchema>;
