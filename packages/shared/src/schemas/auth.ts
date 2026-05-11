import { z } from 'zod';

import { DEFAULTS, DEVICE_CODE_USER_CODE_REGEX } from '../constants';

export const emailSchema = z.string().email().toLowerCase().trim();

export const otpRequestSchema = z.object({
  email: emailSchema,
});

export const otpVerifySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .regex(new RegExp(`^\\d{${DEFAULTS.otpDigits}}$`), `Code must be ${DEFAULTS.otpDigits} digits`),
});

// CLI device-code flow (RFC 8628 inspired)
export const deviceCodeStartSchema = z.object({
  clientName: z.string().min(1).max(60).optional(),
});

export const deviceCodePollSchema = z.object({
  deviceCode: z.string().min(20).max(120),
});

// User-typed code on the approval page. We strip hyphens before validating.
export const deviceCodeUserCodeSchema = z
  .string()
  .transform((s) => s.replace(/-/g, '').toUpperCase())
  .pipe(z.string().regex(DEVICE_CODE_USER_CODE_REGEX, 'Invalid code format'));

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type DeviceCodeStartInput = z.infer<typeof deviceCodeStartSchema>;
export type DeviceCodePollInput = z.infer<typeof deviceCodePollSchema>;

// ---- responses ----

export const deviceCodeStartResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  // Where the human approves. The CLI prints this; if it can spawn a browser
  // it should open `verificationUriComplete` so the user doesn't have to type.
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url(),
  expiresIn: z.number().int().positive(), // seconds until the device code dies
  interval: z.number().int().positive(), // seconds the CLI should sleep between polls
});

export const deviceCodePollResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    interval: z.number().int().positive(),
  }),
  z.object({
    status: z.literal('approved'),
    token: z.string(),
    user: z.object({
      id: z.string(),
      email: emailSchema,
      name: z.string().nullable(),
    }),
  }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
  // Returned if the CLI polls too aggressively. Honor the new interval.
  z.object({
    status: z.literal('slow-down'),
    interval: z.number().int().positive(),
  }),
]);

export const meResponseSchema = z.object({
  id: z.string(),
  email: emailSchema,
  name: z.string().nullable(),
});

export type DeviceCodeStartResponse = z.infer<typeof deviceCodeStartResponseSchema>;
export type DeviceCodePollResponse = z.infer<typeof deviceCodePollResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
