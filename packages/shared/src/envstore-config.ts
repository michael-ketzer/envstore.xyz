// `envstore.json` — the repo-local config that connects a working directory to
// a remote workspace/project. Committable to git — contains NO secrets, NO
// tokens, NO keys. Just routing information.
//
// Read by the CLI on every `envstore push` / `pull`. Displayed in the web
// dashboard's "Connect" panel so users can copy it into their repo.

import { z } from 'zod';

import { environmentSlugSchema } from './schemas/environment';
import { projectSlugSchema } from './schemas/project';
import { workspaceSlugSchema } from './schemas/workspace';

export const ENVSTORE_CONFIG_VERSION = 1;
export const ENVSTORE_CONFIG_FILENAME = 'envstore.json';

export const envstoreConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(ENVSTORE_CONFIG_VERSION).default(ENVSTORE_CONFIG_VERSION),
  workspace: workspaceSlugSchema,
  project: projectSlugSchema,
  defaultEnv: environmentSlugSchema.optional(),
  // For self-hosted instances. Omitted means use the canonical envstore.xyz API.
  apiUrl: z.string().url().optional(),
});

export type EnvstoreConfig = z.infer<typeof envstoreConfigSchema>;

export type RenderEnvstoreConfigInput = {
  workspace: string;
  project: string;
  defaultEnv?: string;
  apiUrl?: string;
  schemaUrl?: string;
};

// Produce the exact JSON string we ship in the dashboard's "Connect" panel and
// in `envstore init`. Stable key order, two-space indent, trailing newline.
export function renderEnvstoreConfig(input: RenderEnvstoreConfigInput): string {
  const obj: Record<string, unknown> = {};
  if (input.schemaUrl) obj.$schema = input.schemaUrl;
  obj.version = ENVSTORE_CONFIG_VERSION;
  obj.workspace = input.workspace;
  obj.project = input.project;
  if (input.defaultEnv) obj.defaultEnv = input.defaultEnv;
  if (input.apiUrl) obj.apiUrl = input.apiUrl;
  return `${JSON.stringify(obj, null, 2)}\n`;
}
