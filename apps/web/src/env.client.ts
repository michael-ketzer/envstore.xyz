// Client-safe env values. Must contain ONLY NEXT_PUBLIC_* variables.
import { z } from 'zod';

const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
});

const parsed = clientEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
});

export const clientEnv = parsed;
