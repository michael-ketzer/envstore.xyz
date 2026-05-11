# Contributing to envstore

Thanks for being here. envstore is AGPL — your changes will be open too.

## Local dev setup

Requirements:

- **Node 20.9+** (we develop on Node 24)
- **pnpm 11+** — `npm install -g pnpm@11` or [corepack enable](https://nodejs.org/api/corepack.html)
- **Bun 1.3+** for the CLI — `curl -fsSL https://bun.sh/install | bash`
- **Postgres** — easiest path: [Neon](https://neon.tech) free tier

```sh
git clone https://github.com/michael-ketzer/envstore.xyz
cd envstore.xyz
pnpm install
cp .env.example .env
# Fill in at minimum: DATABASE_URL, DIRECT_URL, AUTH_SECRET, NEXT_PUBLIC_APP_URL
pnpm db:migrate
pnpm dev   # Next.js dev server on http://localhost:3000
```

For the CLI against your local dev server:

```sh
~/.bun/bin/bun run apps/cli/src/index.ts --api-url http://localhost:3000 login
```

After the first `--api-url`, the CLI remembers it — subsequent commands don't need the flag.

## Monorepo layout

```
apps/
  web/        Next.js 16 — dashboard + API + auth + R2 presigning
  cli/        Bun-compiled `envstore` CLI

packages/
  db/         Prisma schema + client
  shared/     Zod schemas, constants, helpers used by both apps
  crypto/     Hash + age wrappers (age is at subpath export — never imported by web)
  ui/         Shared UI components + Tailwind v4 theme
  config/     Shared tsconfig + ESLint flat configs
```

## Hard rules

- **Zero-knowledge invariant** — the server must never see plaintext or any
  private key material. PRs that violate this won't merge.
- **Schema changes** — always `pnpm db:migrate`, never `pnpm db:push`. Name
  migrations descriptively (`add_workspace_description`, not `migration`).
- **Server actions** — `'use server'` files can only export async functions.
  No object / constant exports.
- **`server-only` everywhere** — modules that touch the DB or read secrets
  must `import 'server-only'` at the top, so client bundling errors loudly.

## Conventions

- TypeScript strict mode (already configured in `packages/config`).
- Prettier + ESLint flat config. Run `pnpm format` and `pnpm lint` before pushing.
- Workspace cross-imports: extensionless (`from './foo'`, not `./foo.js`).
- React components: server by default, `'use client'` only when needed.

## Running checks

```sh
pnpm typecheck   # tsc --noEmit across all packages (Turborepo)
pnpm lint        # ESLint flat config
pnpm format      # Prettier --write
pnpm --filter @envstore/web build   # production Next.js build
pnpm --filter @envstore/cli build   # Bun-compiled CLI binary
```

CI runs `typecheck` + `lint` + `build` on every PR (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Pull request checklist

- [ ] Branched from `main`
- [ ] One concern per PR — don't bundle refactors with features
- [ ] `pnpm typecheck` + `pnpm lint` pass locally
- [ ] If you touched schema: `pnpm db:migrate` produced a migration file
- [ ] If you touched encryption / auth / authorization: extra eyes welcome
- [ ] Don't add dependencies you don't use; keep the install slim

## Reporting bugs

GitHub Issues, please. Include:

- OS, Node version, pnpm version
- Steps to reproduce
- What you expected vs. what happened
- Logs if available (redact secrets)

**Security issues** — see [SECURITY.md](SECURITY.md). Don't open a public issue.

## Cutting a release (maintainers)

```sh
# bump version in package.json files
git tag v0.x.y
git push origin v0.x.y
```

The release workflow ([.github/workflows/release.yml](.github/workflows/release.yml))
builds CLI binaries for darwin/linux × x64/arm64 and attaches them to the
GitHub release. The `https://envstore.xyz/install` script picks up the latest
release automatically.

## License

AGPL v3. By contributing you agree your contributions are licensed under the
same terms.
