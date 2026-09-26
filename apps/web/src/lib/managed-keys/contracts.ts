import { z } from 'zod';

// Identifiers only: context must never contain briefing text or human names.
export const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
export const keyIdSchema = z.uuid();
export const contextSchema = z
  .object({
    purpose: identifier,
    teamId: identifier,
    campaignId: identifier,
    creatorId: identifier,
    assignmentId: identifier.optional(),
    // Shinra currently calls the assignment/access binding `accessId`.
    accessId: identifier.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.assignmentId) !== Boolean(v.accessId));
export const generateSchema = z.object({ context: contextSchema }).strict();
export const unwrapSchema = generateSchema.extend({
  wrappedKey: z.string().min(1).max(4096),
});
export const provisionSchema = z
  .object({
    name: identifier,
    tenantId: identifier,
    environment: identifier,
    purpose: identifier,
  })
  .strict();
export const credentialSchema = z
  .object({
    applicationId: identifier,
    tenantId: identifier,
    environment: identifier,
    expiresInDays: z.number().int().min(1).max(365).default(90),
    grants: z
      .array(
        z
          .object({
            keyId: keyIdSchema,
            operations: z
              .array(z.enum(['generate', 'unwrap']))
              .min(1)
              .max(2)
              .refine((ops) => new Set(ops).size === ops.length),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine((grants) => new Set(grants.map((g) => g.keyId)).size === grants.length),
  })
  .strict();
export type BindingContext = z.infer<typeof contextSchema>;
export type Operation = 'generate' | 'unwrap';
export const PROVIDER = 'envstore-openbao-transit' as const;
export const VERSION = 1 as const;
export const CREDENTIAL_PREFIX = 'esmk_';
