// Centralized constants — shared by web, CLI, and API.
// Anything magic-number that appears in more than one place lives here.

// ---------- Pricing ----------
export const PRICING = {
  monthlyCents: 199, // $1.99/mo per workspace (including personal)
  currency: 'USD' as const,
  trialDays: 14,
  // After cancel, reads stay open for this many days so users can pull their data.
  postCancelReadGraceDays: 30,
} as const;

// ---------- Defaults ----------
export const DEFAULTS = {
  // How long a soft-deleted project/environment stays recoverable before hard-delete cron sweeps it.
  softDeleteRetentionDays: 30,
  // How many historical versions to keep per environment by default.
  versionHistoryLimit: 50,
  // Length of an OTP code shown to the user.
  otpDigits: 6,
  otpExpiryMinutes: 10,
  otpMaxAttempts: 5,
  // CLI device-code auth — how long the user has to confirm in browser.
  deviceCodeExpiryMinutes: 10,
  // How many seconds the CLI should wait between polls. The server may bump
  // this on the wire if it wants to back off.
  deviceCodePollIntervalSec: 5,
  // Cap on how many CLI tokens a single user can hold simultaneously. Stops a
  // forgotten CI runner from leaking unbounded credentials. Stale ones get
  // surfaced in /settings.
  maxCliTokensPerUser: 20,
  // Invite link lifetime.
  inviteExpiryDays: 7,
} as const;

// Alphabet for device-code user codes — no I/L/O/0/1 ambiguity, all uppercase.
// 32 chars = 5 bits per char, so an 8-char code is 40 bits of entropy. We
// only need it to survive a 10-minute window against a rate-limited brute force.
export const DEVICE_CODE_USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DEVICE_CODE_USER_CODE_LENGTH = 8;
// Format presented to the user: "XXXX-XXXX". Hyphen ignored on input.
export const DEVICE_CODE_USER_CODE_REGEX = /^[A-HJ-NP-Z2-9]{8}$/;

// ---------- Limits ----------
// File-size policy: the server can never inspect plaintext, so enforcement
// happens in three places (CLI text check, API size validation, R2
// ContentLengthRange). The cap is on CIPHERTEXT — age adds ~200 bytes per
// recipient on top of plaintext.
export const LIMITS = {
  slugMin: 2,
  slugMax: 40,
  nameMax: 100,
  descriptionMax: 500,

  // Plaintext caps (CLI-enforced before encryption)
  maxPlaintextBytes: 1024 * 1024, // 1 MB — refuse outright
  softPlaintextWarningBytes: 256 * 1024, // 256 KB — CLI prompts "this is unusual, continue?"

  // Ciphertext cap (API-enforced; also fed into the R2 presigned PUT)
  maxCiphertextBytes: 1024 * 1024, // 1 MB — hard cap, no override

  // Sample size for text detection — same threshold git uses.
  textProbeBytes: 8 * 1024,

  commentMax: 280,
  recipientLabelMax: 60,
  recipientMax: 4096, // ssh-rsa keys can be long
  // Hard ceiling on members per workspace — high but finite, to guard against abuse.
  maxMembersPerWorkspace: 1000,
  maxRecipientsPerUser: 50,
} as const;

// ---------- Slugs ----------
// Lowercase, digits, hyphens; can't start or end with hyphen; no double hyphens.
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}[a-z0-9]$/;

// URL slug that always addresses the signed-in user's personal workspace.
// Each personal workspace keeps its own unique slug in the DB, but the URL
// uses this fixed token so users don't have to remember it.
export const PERSONAL_WORKSPACE_URL_SLUG = 'me';

// Reserved slugs that can never be used for workspaces (collide with routes or
// have special semantics — `me` is the personal-workspace shortcut above).
// Three buckets:
//   1. App-route collisions today (/api, /dashboard, /login, …) — these would
//      404 or behave weirdly if a workspace took the same slug.
//   2. JS-keyword-shaped strings that confuse UIs and audit-log readers
//      (`null`, `undefined`, `true`, `false`, `nan`).
//   3. Operational namespaces we may want to add later (`status`, `mail`,
//      `static`, …) — cheap to reserve up-front, expensive to evict an
//      already-occupied slug.
export const RESERVED_WORKSPACE_SLUGS = new Set([
  // App-route collisions
  'api',
  'app',
  'auth',
  'billing',
  'cli',
  'dashboard',
  'docs',
  'help',
  'install',
  'invite',
  'login',
  'logout',
  'new',
  'onboarding',
  'pricing',
  'register',
  'settings',
  'signin',
  'signup',
  'status',
  'support',
  'terms',
  'privacy',
  'admin',
  'administrator',
  'me',
  'public',
  'static',
  'www',
  'security',
  'schema',
  'verify',
  'refund',
  'imprint',
  'paddle',
  'resend',
  'internal',
  'well-known',
  // JS-keyword-shaped — leak from naive front-end stringification of nullish
  // values, also confuse audit-log readers ("workspace null was deleted").
  'null',
  'undefined',
  'nan',
  'true',
  'false',
  // Operational
  'webhook',
  'webhooks',
  'health',
  'healthz',
  'metrics',
  'oauth',
  'sso',
  'logs',
  'log',
  'cron',
  'robots',
  'sitemap',
  'favicon',
]);

// ---------- Workspace roles ----------
export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

// ---------- Recipient kinds ----------
export const RECIPIENT_KINDS = ['AGE_X25519', 'SSH_ED25519', 'SSH_RSA'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

// Quick detection — full validation happens in @envstore/crypto.
export function detectRecipientKind(recipient: string): RecipientKind | null {
  const trimmed = recipient.trim();
  if (trimmed.startsWith('age1')) return 'AGE_X25519';
  if (trimmed.startsWith('ssh-ed25519 ')) return 'SSH_ED25519';
  if (trimmed.startsWith('ssh-rsa ')) return 'SSH_RSA';
  return null;
}
