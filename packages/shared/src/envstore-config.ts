// `envstore.json` — the repo-local config that connects a working directory to
// a remote workspace/project. Committable to git — contains NO secrets, NO
// tokens, NO keys. Just routing information.
//
// Read by the CLI on every `envstore push` / `pull`. Displayed in the web
// dashboard's "Connect" panel so users can copy it into their repo.
//
// Two shapes are accepted on read:
//
//   Flat (single-file, legacy):
//   { workspace, project, defaultEnv?, apiUrl? }
//
//   Multi (monorepo):
//   { workspace, files: [{ path, project, environment? }, ...], apiUrl? }
//
// Both are emitted in different scenarios — `envstore init` writes the flat
// form for a single-project repo and the multi form for a monorepo. Loaders
// keep both supported indefinitely; existing users never have to migrate.

import { z } from 'zod';

import { environmentSlugSchema } from './schemas/environment';
import { projectSlugSchema } from './schemas/project';
import { workspaceSlugSchema } from './schemas/workspace';

export const ENVSTORE_CONFIG_VERSION = 1;
export const ENVSTORE_CONFIG_FILENAME = 'envstore.json';

// Per-file entry inside the `files` array.
// `path` is RELATIVE to the directory holding this envstore.json and must
// resolve inside that directory tree. We reject:
//   - absolute paths (`/etc/passwd`, `C:\Windows\…`) — would write outside the repo
//   - `~`-prefixed paths — shell-style home expansion
//   - control characters / null bytes — invisible-modification trick
//   - any `..` segment — even if it happens to resolve back inside, configs
//     should never need them; the runtime resolve in pull.ts also rejects
//     any final path outside the config's directory as defense-in-depth.
//
// Rationale: envstore.json is committable to git. Without this validation a
// malicious PR could set `files[].path` to `~/.ssh/authorized_keys`,
// `~/.zshrc`, `~/Library/LaunchAgents/x.plist`, etc., and the next teammate
// to run `envstore pull` would have those files atomically overwritten with
// the attacker-supplied plaintext (writeSecretFile unlinks-then-creates
// O_EXCL, so even existing files are clobbered).
// Returns null if the path is acceptable, or a human-readable reason if not.
export function checkSafeRelativePath(input: string): string | null {
  if (input.length === 0) return 'path must not be empty';
  if (/[\x00-\x1f\x7f]/.test(input)) return 'path must not contain control characters';
  if (input.startsWith('/')) return 'path must be relative (not absolute)';
  if (/^[a-zA-Z]:[\\/]/.test(input)) return 'path must be relative (not absolute)';
  if (input.startsWith('\\\\')) return 'UNC paths are not allowed';
  if (input.startsWith('~')) return 'paths must not start with ~';
  // Reject any `..` segment, regardless of where it ends up resolving.
  const segments = input.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) return 'path must not contain `..` segments';
  return null;
}

export const envstoreFileEntrySchema = z.object({
  path: z
    .string()
    .min(1)
    .superRefine((p, ctx) => {
      const reason = checkSafeRelativePath(p);
      if (reason) {
        ctx.addIssue({ code: 'custom', message: reason });
      }
    }),
  project: projectSlugSchema,
  environment: environmentSlugSchema.optional(),
});

export type EnvstoreFileEntry = z.infer<typeof envstoreFileEntrySchema>;

// envstore.json is repo-local and committable. A malicious PR could otherwise
// point `apiUrl` at an attacker-controlled host — combined with an
// ENVSTORE_TOKEN set in CI, that would exfiltrate the bearer on the next
// push. We require HTTPS (with a localhost escape hatch for self-hosted dev)
// at the schema layer so the config parser rejects suspect URLs before any
// auth header is sent. The CI-token-vs-config-URL pairing is additionally
// guarded by assertTokenUrlSafe at the auth layer (creds.ts).
const apiUrlSchema = z
  .string()
  .url()
  .refine(
    (raw) => {
      const u = new URL(raw);
      if (u.protocol === 'https:') return true;
      if (u.protocol === 'http:') {
        // WHATWG URL keeps the surrounding brackets on IPv6 hostnames
        // (e.g. `new URL('http://[::1]:3000').hostname === '[::1]'`), so
        // we strip them before comparing — otherwise `http://[::1]:…` for
        // local dev would be rejected as non-loopback.
        const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
      }
      return false;
    },
    { message: 'apiUrl must be https:// (http:// only allowed for localhost).' },
  );

// Flat (legacy / single-project) shape — workspace + project at the top level,
// no path binding. The CLI's push/pull commands take the filename as an arg
// (defaulting to `.env`).
const flatConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(ENVSTORE_CONFIG_VERSION).default(ENVSTORE_CONFIG_VERSION),
  workspace: workspaceSlugSchema,
  project: projectSlugSchema,
  defaultEnv: environmentSlugSchema.optional(),
  // For self-hosted instances. Omitted means use the canonical envstore.xyz API.
  apiUrl: apiUrlSchema.optional(),
});

// Multi (monorepo) shape — workspace at the top, a `files[]` array binding
// each on-disk path to a project (and optionally an environment).
const multiConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(ENVSTORE_CONFIG_VERSION).default(ENVSTORE_CONFIG_VERSION),
  workspace: workspaceSlugSchema,
  files: z.array(envstoreFileEntrySchema).min(1),
  apiUrl: apiUrlSchema.optional(),
});

// Discriminated by presence of `files`. zod's union picks the right one.
export const envstoreConfigSchema = z.union([multiConfigSchema, flatConfigSchema]);

export type EnvstoreConfigFlat = z.infer<typeof flatConfigSchema>;
export type EnvstoreConfigMulti = z.infer<typeof multiConfigSchema>;
export type EnvstoreConfig = z.infer<typeof envstoreConfigSchema>;

export function isMultiConfig(cfg: EnvstoreConfig): cfg is EnvstoreConfigMulti {
  return 'files' in cfg;
}

// Normalize either shape into a single `files[]` view. Useful for code paths
// (push/pull iteration, display) that don't want to branch on the shape.
// For flat configs the synthesized entry uses `.env` as the default path —
// callers that need to honor a user-supplied filename override should branch
// on `isMultiConfig` instead.
export function normalizeToFiles(cfg: EnvstoreConfig): EnvstoreFileEntry[] {
  if (isMultiConfig(cfg)) return cfg.files;
  return [
    {
      path: '.env',
      project: cfg.project,
      environment: cfg.defaultEnv,
    },
  ];
}

export type RenderEnvstoreConfigInput =
  | {
      workspace: string;
      project: string;
      defaultEnv?: string;
      apiUrl?: string;
      schemaUrl?: string;
    }
  | {
      workspace: string;
      files: EnvstoreFileEntry[];
      apiUrl?: string;
      schemaUrl?: string;
    };

// Produce the exact JSON string we ship in the dashboard's "Connect" panel and
// in `envstore init`. Stable key order, two-space indent, trailing newline.
// Picks the flat form when given a single project, the multi form when given
// a files[] array.
export function renderEnvstoreConfig(input: RenderEnvstoreConfigInput): string {
  const obj: Record<string, unknown> = {};
  if (input.schemaUrl) obj.$schema = input.schemaUrl;
  obj.version = ENVSTORE_CONFIG_VERSION;
  obj.workspace = input.workspace;
  if ('files' in input) {
    obj.files = input.files.map((f) => {
      const entry: Record<string, unknown> = { path: f.path, project: f.project };
      if (f.environment) entry.environment = f.environment;
      return entry;
    });
  } else {
    obj.project = input.project;
    if (input.defaultEnv) obj.defaultEnv = input.defaultEnv;
  }
  if (input.apiUrl) obj.apiUrl = input.apiUrl;
  return `${JSON.stringify(obj, null, 2)}\n`;
}
