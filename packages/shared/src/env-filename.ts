// Filename → environment-slug detection.
//
// Handles the conventional .env file naming used by Next.js, Vite, dotenv-cli,
// etc. The CLI calls this on `envstore push` so users can omit `--env` when the
// filename is informative. The web uses it in docs/examples.
//
//   .env                       → development
//   .env.local                 → development (.local is a local-override suffix)
//   .env.production            → production
//   .env.production.local      → production
//   .env.staging               → staging
//   .env.test                  → test
//   anything-else.env          → 'anything-else' (heuristic; lower confidence)
//   <unrecognized>             → null (caller must prompt or pass --env)

import { SLUG_REGEX } from './constants';

export type EnvDetection =
  | { detected: true; slug: string; confidence: 'high' | 'low' }
  | { detected: false };

const DEFAULT_ENV_SLUG = 'development';

export function detectEnvironmentFromFilename(filename: string): EnvDetection {
  // Strip directory components so callers can pass paths directly.
  const base = filename.split('/').pop()?.split('\\').pop() ?? filename;

  // Strip trailing `.local` (local-override suffix common to Next/Vite).
  const trimmed = base.replace(/\.local$/i, '');

  // Bare `.env` or `.env` after stripping `.local` → default env.
  if (trimmed === '.env') {
    return { detected: true, slug: DEFAULT_ENV_SLUG, confidence: 'high' };
  }

  // `.env.<name>` — the canonical multi-env convention.
  const dotEnvName = /^\.env\.([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i.exec(trimmed);
  if (dotEnvName) {
    const slug = dotEnvName[1]!.toLowerCase();
    if (SLUG_REGEX.test(slug)) {
      return { detected: true, slug, confidence: 'high' };
    }
  }

  // `<name>.env` reversed form (less common, lower confidence).
  const reversed = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.env$/i.exec(trimmed);
  if (reversed) {
    const slug = reversed[1]!.toLowerCase();
    if (SLUG_REGEX.test(slug)) {
      return { detected: true, slug, confidence: 'low' };
    }
  }

  return { detected: false };
}

// Inverse: given an env slug, suggest the filename the CLI would write on pull.
// `production` → `.env.production`, `development` → `.env`.
export function defaultFilenameForEnvironment(slug: string): string {
  return slug === DEFAULT_ENV_SLUG ? '.env' : `.env.${slug}`;
}
