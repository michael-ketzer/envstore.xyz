// JSON Schema for `envstore.json` — the repo-local config file. Linked via the
// `$schema` field in the rendered config so IDEs (VS Code, JetBrains) get
// autocompletion and validation out of the box.

import { NextResponse } from 'next/server';

import { ENVSTORE_CONFIG_VERSION, SLUG_REGEX } from '@envstore/shared';

const slugPattern = SLUG_REGEX.source;

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://envstore.xyz/schema/envstore.json',
  title: 'envstore project config',
  description:
    'Repo-local config that connects a working directory to a remote envstore workspace/project. ' +
    'Commit this file — it contains routing information only, no secrets.',
  type: 'object',
  additionalProperties: false,
  required: ['workspace', 'project'],
  properties: {
    $schema: {
      type: 'string',
      description: 'JSON Schema URL — points at this file.',
    },
    version: {
      type: 'integer',
      const: ENVSTORE_CONFIG_VERSION,
      description: 'envstore.json schema version. Currently 1.',
    },
    workspace: {
      type: 'string',
      pattern: slugPattern,
      minLength: 2,
      maxLength: 40,
      description: 'Workspace slug (envstore.xyz/<workspace>).',
    },
    project: {
      type: 'string',
      pattern: slugPattern,
      minLength: 2,
      maxLength: 40,
      description: 'Project slug (envstore.xyz/<workspace>/<project>).',
    },
    defaultEnv: {
      type: 'string',
      pattern: slugPattern,
      minLength: 2,
      maxLength: 40,
      description:
        'Environment slug used when the CLI cannot detect one from the file name (e.g. `envstore pull` with no args).',
    },
    apiUrl: {
      type: 'string',
      format: 'uri',
      description: 'Override the API endpoint. Only set this for self-hosted envstore instances.',
    },
  },
} as const;

export function GET() {
  return NextResponse.json(schema, {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
