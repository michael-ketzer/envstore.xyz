// Prisma 7 config. Connection URLs moved out of schema.prisma into here.
//
// - `migrate` and `generate` read DIRECT_URL (unpooled — Neon's PgBouncer
//   pooled connection doesn't support all DDL).
// - Runtime queries use DATABASE_URL via @prisma/adapter-pg, wired up in
//   packages/db/src/index.ts.

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, env } from 'prisma/config';

// Load env from the repo root — `pnpm db:*` scripts run in packages/db, so
// dotenv's default cwd lookup misses our single root .env file.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const rel of ['../../.env', '../../.env.local']) {
  const full = path.resolve(here, rel);
  if (existsSync(full)) loadEnv({ path: full, override: false });
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
});
