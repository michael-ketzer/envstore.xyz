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

export const versionRollbackSchema = z.object({
  versionId: z.string().min(1),
});

export type VersionInitInput = z.infer<typeof versionInitSchema>;
export type VersionRollbackInput = z.infer<typeof versionRollbackSchema>;
