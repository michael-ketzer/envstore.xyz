import { LIMITS, RESERVED_WORKSPACE_SLUGS, SLUG_REGEX } from './constants';

export type SlugValidationOk = { ok: true };
export type SlugValidationErr = { ok: false; reason: string };
export type SlugValidationResult = SlugValidationOk | SlugValidationErr;

export function validateSlug(slug: string, opts?: { reserved?: Set<string> }): SlugValidationResult {
  if (slug.length < LIMITS.slugMin) {
    return { ok: false, reason: `Slug must be at least ${LIMITS.slugMin} characters.` };
  }
  if (slug.length > LIMITS.slugMax) {
    return { ok: false, reason: `Slug must be at most ${LIMITS.slugMax} characters.` };
  }
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      reason: 'Use lowercase letters, digits, and single hyphens. Cannot start or end with a hyphen.',
    };
  }
  if (opts?.reserved?.has(slug)) {
    return { ok: false, reason: 'This slug is reserved.' };
  }
  return { ok: true };
}

export function validateWorkspaceSlug(slug: string): SlugValidationResult {
  return validateSlug(slug, { reserved: RESERVED_WORKSPACE_SLUGS });
}

// Best-effort slugification for "My Workspace" -> "my-workspace".
// Not guaranteed unique — caller appends -2/-3 on collision.
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slugMax);
}
