// Prisma 7 config. Connection URLs moved out of schema.prisma into here.
//
// - `prisma migrate` needs DIRECT_URL (unpooled — Neon's PgBouncer pooled
//   connection doesn't support all DDL).
// - `prisma generate` needs nothing — just the schema location.
// - Runtime queries use DATABASE_URL via @prisma/adapter-pg, wired up in
//   packages/db/src/index.ts.
//
// We DON'T use prisma/config's `env()` helper because it throws eagerly when
// the var is missing, even when generate doesn't need it. On Vercel builds
// only DATABASE_URL is set; generate would fail unnecessarily. By reading
// process.env directly and gating the datasource block, generate works
// everywhere while migrate (which requires DIRECT_URL) still validates.

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'prisma/config';

// Load env from the repo root — `pnpm db:*` scripts run in packages/db, so
// dotenv's default cwd lookup misses our single root .env file.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const rel of ['../../.env', '../../.env.local']) {
  const full = path.resolve(here, rel);
  if (existsSync(full)) loadEnv({ path: full, override: false });
}

const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Only include the datasource if we have a URL — generate doesn't need it,
  // and `prisma migrate` will print a clear error if DIRECT_URL isn't set
  // when you actually try to migrate.
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
