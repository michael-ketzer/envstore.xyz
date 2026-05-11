<!-- Thanks for the PR. A few seconds filling this in saves a lot of review back-and-forth. -->

## What changed

<!-- 1–3 sentences. The "why" matters more than the "what." -->

## How to verify

<!--
Concrete steps a reviewer can run. Examples:
- `pnpm dev`, then sign in and...
- `envstore push .env --env staging`, expect ...
-->

## Checklist

- [ ] One concern per PR (separate refactors from features)
- [ ] `pnpm typecheck` + `pnpm lint` pass locally
- [ ] If schema changed: `pnpm db:migrate` produced a versioned migration file
- [ ] If encryption / auth / authorization changed: called out below for extra review
- [ ] No plaintext or private-key material on the server path
- [ ] No new dependencies that aren't actually used

## Security-sensitive changes

<!--
Leave blank unless you touched anything in:
- apps/web/src/lib/auth*.ts
- apps/web/src/lib/api-auth.ts
- apps/web/src/lib/cli-tokens.ts
- apps/web/src/lib/device-auth.ts
- apps/web/src/lib/project-link-codes.ts
- apps/web/src/lib/rate-limit.ts
- apps/web/src/app/api/**/route.ts
- packages/crypto/**
- apps/cli/src/lib/{identity,creds,keychain}.ts
-->
