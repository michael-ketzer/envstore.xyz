import { z } from 'zod';

// Identifiers only: context must never contain briefing text or human names.
export const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
export const keyIdSchema = z.uuid();
export const legacyContextSchema = z
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
export const genericContextSchema = z
  .object({
    purpose: identifier,
    tenantId: identifier,
    subjectId: identifier.optional(),
  })
  .strict();
// Keep each wire format intact: field names are cryptographic bindings, so a
// generic context must never be translated into the legacy briefing fields.
export const contextSchema = z.union([legacyContextSchema, genericContextSchema]);
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
// Applications name the key in the request body; the tenant comes from context.
export const applicationUnwrapSchema = unwrapSchema.extend({ keyId: keyIdSchema }).strict();
export const applicationSchema = z
  .object({
    name: identifier,
    environment: identifier,
    purpose: identifier,
    keyName: identifier,
    maxTenants: z.number().int().min(1).max(100000).default(1000),
    // A Vercel deployment identity: immutable team and project IDs plus the
    // deployment environment (development, preview, production, or custom).
    vercel: z
      .object({
        teamId: z.string().regex(/^team_[A-Za-z0-9]{1,64}$/),
        projectId: z.string().regex(/^prj_[A-Za-z0-9]{1,64}$/),
        environment: identifier,
      })
      .strict()
      .optional(),
    token: z
      .object({ expiresInDays: z.number().int().min(1).max(365).default(90) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.vercel) !== Boolean(v.token));
export type BindingContext = z.infer<typeof contextSchema>;
export function contextTenantId(context: BindingContext): string {
  return 'tenantId' in context ? context.tenantId : context.teamId;
}
export type Operation = 'generate' | 'unwrap';
export const PROVIDER = 'envstore-openbao-transit' as const;
export const VERSION = 1 as const;
export const CREDENTIAL_PREFIX = 'esmk_';
export const APPLICATION_TOKEN_PREFIX = 'esma_';
