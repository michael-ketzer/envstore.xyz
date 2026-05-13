import { z } from 'zod';

import { LIMITS } from '../constants';

// Two-phase upload:
//   1. POST /versions/init  → returns { versionId, uploadUrl }
//   2. PUT to uploadUrl     → ciphertext directly to R2
//   3. POST /versions/:id/finalize  → server verifies size + sha256, flips currentVersion pointer.

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be hex(64)');

export const versionInitSchema = z.object({
  // Hard ciphertext ceiling — server rejects anything larger before issuing a
  // presigned URL. R2 then enforces the same cap via ContentLengthRange.
  ciphertextSize: z.number().int().positive().max(LIMITS.maxCiphertextBytes),
  ciphertextSha256: sha256HexSchema,
  recipientsHash: sha256HexSchema,
  comment: z.string().max(LIMITS.commentMax).optional(),
});

export const versionFinalizeSchema = z.object({
  // Confirms the client successfully uploaded; server checks R2 size+hash to confirm.
});

export const versionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

// `versionId` or `version` (the monotonic int). The CLI mostly knows the
// int — humans don't memorize cuids — so we accept either and the server
// resolves whichever is supplied. Exactly one must be present.
export const versionRollbackSchema = z
  .object({
    versionId: z.string().min(1).optional(),
    version: z.number().int().positive().optional(),
  })
  .refine(
    (v) => Boolean(v.versionId) !== Boolean(v.version !== undefined),
    'pass exactly one of `versionId` or `version`',
  );

// One row in the version-history list. `current` flags the row that
// Environment.currentVersionId currently points at, so the CLI/dashboard
// can render a marker without a second query.
export const versionSummarySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  ciphertextSize: z.number().int().nonnegative(),
  comment: z.string().nullable(),
  createdAt: z.string(), // ISO
  createdByEmail: z.string().nullable(),
  current: z.boolean(),
});

export const versionListResponseSchema = z.object({
  environmentSlug: z.string(),
  versions: z.array(versionSummarySchema),
  // Workspace-level cap surfaced so the CLI can say
  // "32 of 50 — older ones pruned" without a second roundtrip.
  versionHistoryLimit: z.number().int().positive(),
});

export type VersionInitInput = z.infer<typeof versionInitSchema>;
export type VersionRollbackInput = z.infer<typeof versionRollbackSchema>;
export type VersionSummary = z.infer<typeof versionSummarySchema>;
export type VersionListResponse = z.infer<typeof versionListResponseSchema>;
