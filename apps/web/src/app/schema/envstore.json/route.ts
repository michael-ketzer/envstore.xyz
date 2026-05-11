// JSON Schema for `envstore.json` — the repo-local config file. Linked via the
// `$schema` field in the rendered config so IDEs (VS Code, JetBrains) get
// autocompletion and validation out of the box.

import { NextResponse } from 'next/server';

import { ENVSTORE_CONFIG_VERSION, SLUG_REGEX } from '@envstore/shared';

const slugPattern = SLUG_REGEX.source;

const slugProp = (description: string) => ({
  type: 'string',
  pattern: slugPattern,
  minLength: 2,
  maxLength: 40,
  description,
});

// Two accepted shapes — flat (single project) and multi (monorepo / files
// array). `oneOf` makes both valid; editors will pick the matching branch
// based on which keys are present.
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://envstore.xyz/schema/envstore.json',
  title: 'envstore project config',
  description:
    'Repo-local config that connects a working directory to a remote envstore workspace/project. ' +
    'Commit this file — it contains routing information only, no secrets.',
  type: 'object',
  oneOf: [
    {
      title: 'Single project (flat)',
      type: 'object',
      additionalProperties: false,
      required: ['workspace', 'project'],
      properties: {
        $schema: { type: 'string', description: 'JSON Schema URL — points at this file.' },
        version: {
          type: 'integer',
          const: ENVSTORE_CONFIG_VERSION,
          description: 'envstore.json schema version. Currently 1.',
        },
        workspace: slugProp('Workspace slug (envstore.xyz/<workspace>).'),
        project: slugProp('Project slug (envstore.xyz/<workspace>/<project>).'),
        defaultEnv: slugProp(
          'Environment slug used when the CLI cannot detect one from the file name (e.g. `envstore pull` with no args).',
        ),
        apiUrl: {
          type: 'string',
          format: 'uri',
          description:
            'Override the API endpoint. Only set this for self-hosted envstore instances.',
        },
      },
    },
    {
      title: 'Monorepo (files array)',
      type: 'object',
      additionalProperties: false,
      required: ['workspace', 'files'],
      properties: {
        $schema: { type: 'string', description: 'JSON Schema URL — points at this file.' },
        version: {
          type: 'integer',
          const: ENVSTORE_CONFIG_VERSION,
          description: 'envstore.json schema version. Currently 1.',
        },
        workspace: slugProp('Workspace slug shared by every file entry below.'),
        files: {
          type: 'array',
          minItems: 1,
          description:
            'One entry per env file in the repo. `envstore push` / `envstore pull` operate on every entry by default; positional args + --project / --env flags filter.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'project'],
            properties: {
              path: {
                type: 'string',
                minLength: 1,
                description:
                  'Path to the env file, relative to the directory holding this envstore.json.',
              },
              project: slugProp('Remote project slug this file is bound to.'),
              environment: slugProp(
                'Environment slug for this file (e.g. `production`). Falls back to filename detection (`.env.production`) if omitted.',
              ),
            },
          },
        },
        apiUrl: {
          type: 'string',
          format: 'uri',
          description:
            'Override the API endpoint. Only set this for self-hosted envstore instances.',
        },
      },
    },
  ],
} as const;

export function GET() {
  return NextResponse.json(schema, {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
