import 'server-only';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { env } from '@/env';
import { identifier } from './contracts';
import { ManagedKeyError } from './http';

// Vercel signs tokens for both issuer modes (global and per team) with one key set.
const JWKS_URL = new URL('https://oidc.vercel.com/.well-known/jwks');
const ISSUER = /^https:\/\/oidc\.vercel\.com(\/[a-z0-9][a-z0-9-]{0,99})?$/;
// Failures that describe the presented token. Anything else (key set download,
// timeouts, network) is an availability problem on our side.
const TOKEN_ERRORS = new Set([
  errors.JWTClaimValidationFailed.code,
  errors.JWTExpired.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWSInvalid.code,
  errors.JWTInvalid.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
  errors.JWSSignatureVerificationFailed.code,
]);
let keySet: ReturnType<typeof createRemoteJWKSet> | undefined;

/** A deployment identity from verified, immutable Vercel claims. */
export type VercelIdentity = { teamId: string; projectId: string; environment: string };

export function isJwt(token: string): boolean {
  return token.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

/** Tokens must be minted for this installation: `getVercelOidcToken({ audience })`. */
export function oidcAudience(): string | null {
  const value = env.MANAGED_KEYS_AUDIENCE ?? env.NEXT_PUBLIC_APP_URL;
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function invalid(): ManagedKeyError {
  return new ManagedKeyError(401, 'Invalid application credential.');
}

/**
 * Verifies a Vercel OIDC token for this installation's audience. Identity is
 * bound to immutable team and project IDs (never renameable slugs or names).
 */
export async function verifyVercelToken(token: string): Promise<VercelIdentity> {
  const audience = oidcAudience();
  if (!audience) throw new ManagedKeyError(503, 'Managed key service is not configured.');
  keySet ??= createRemoteJWKSet(JWKS_URL, { timeoutDuration: 5000 });
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keySet, {
      audience,
      algorithms: ['RS256'],
      clockTolerance: 30,
      // Function tokens live two hours; local development tokens twelve.
      maxTokenAge: '12h',
      requiredClaims: ['iss', 'iat', 'exp'],
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError && TOKEN_ERRORS.has(error.code)) throw invalid();
    throw new ManagedKeyError(503, 'Managed key service unavailable.');
  }
  const { iss, owner_id: teamId, project_id: projectId, environment } = payload;
  if (
    typeof iss !== 'string' ||
    !ISSUER.test(iss) ||
    typeof teamId !== 'string' ||
    !/^team_[A-Za-z0-9]{1,64}$/.test(teamId) ||
    typeof projectId !== 'string' ||
    !/^prj_[A-Za-z0-9]{1,64}$/.test(projectId) ||
    !identifier.safeParse(environment).success
  ) {
    throw invalid();
  }
  return { teamId, projectId, environment: environment as string };
}
