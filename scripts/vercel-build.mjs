// Vercel build orchestrator.
//
// Vercel runs this in place of `pnpm build` (wired via the `vercel-build`
// script in the root package.json — Vercel honors that convention). We use it
// to apply pending Prisma migrations BEFORE the Next.js build runs, so a
// deploy that introduces a new column never lands on a server querying the
// old schema.
//
// We gate `prisma migrate deploy` strictly on VERCEL_ENV=production. Reason:
// preview deploys typically share the production database, and a developer
// pushing a branch with a not-yet-merged migration would otherwise apply it
// to prod just by opening a PR preview — that's a footgun for any
// destructive migration. Production deploys land via main/tag and pass review
// first, so they're the right gate. Preview/dev deploys SKIP migrations and
// run only against the schema that's already live.
//
// Requires DIRECT_URL to be set in the Vercel build env (the unpooled URL
// Prisma needs for migrations; the pooled DATABASE_URL is for runtime only).
// `prisma migrate deploy` is idempotent — re-running it on a fully-migrated
// DB is a no-op.

import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`[vercel-build] failed to spawn ${cmd}:`, result.error);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.status === null) {
    // Killed by signal — propagate as a non-zero exit.
    process.exit(1);
  }
}

const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv === 'production') {
  console.log('[vercel-build] VERCEL_ENV=production — applying pending Prisma migrations.');
  run('pnpm', ['db:migrate:deploy']);
} else {
  console.log(
    `[vercel-build] VERCEL_ENV=${vercelEnv ?? '(unset)'} — skipping migrations. ` +
      'Migrations only run on production deploys; preview/dev share the prod DB ' +
      "and an unmerged migration shouldn't land there from a PR build.",
  );
}

console.log('[vercel-build] Running turbo build.');
run('pnpm', ['build']);
