# envstore

[![CI](https://github.com/michael-ketzer/envstore.xyz/actions/workflows/ci.yml/badge.svg)](https://github.com/michael-ketzer/envstore.xyz/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**Zero-knowledge encrypted `.env` file storage.** The server holds ciphertext
only. Encryption happens on your machine with keys that never leave it.
$1.99/month per workspace. Unlimited team members.

## Why

Vercel's [April 2026 security incident](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident)
prompted them to ask users to mark secret env vars as "sensitive" — and once
marked, those vars can no longer be pulled via CLI or API. Following that
guidance across many working environments broke my `vercel pull` workflow,
and the response itself eroded my trust in the process.

The obvious alternative — services that decrypt env files in your browser —
doesn't help: it's one breach away from the same problem. envstore is the
reaction. The server holds ciphertext only, decryption happens on your
machine, and a full server compromise yields no plaintext.

## What you get

- **End-to-end encryption with [age](https://github.com/FiloSottile/age)** —
  X25519 + ChaCha20-Poly1305. Server stores ciphertext.
- **CLI-first** — `envstore push .env` / `envstore pull`. The CLI encrypts
  before upload and decrypts only on your machine.
- **Multi-environment** — auto-detects from filename
  (`.env.production` → `production`).
- **Versioned** — every push is a new immutable version; rollback by pointer.
- **Team-ready** — invite unlimited members per workspace. Each member's age
  recipient is added to the recipient set automatically.
- **Open source** — AGPL v3. Fork-and-self-host welcome.

## Quick start

```sh
# 1. Install the CLI
curl -fsSL https://envstore.xyz/install | sh

# 2. Sign in (device-code flow, opens browser)
envstore login

# 3. Set up your local age identity (once per machine)
envstore identity init
envstore identity export --clipboard   # back it up — server cannot recover it

# 4. In your project root:
envstore init                 # creates workspace + project + envstore.json
envstore push .env            # encrypts to all workspace members, uploads
envstore push .env.production # auto-detected as "production"

# 5. On another machine (or fresh repo clone):
envstore identity import ~/envstore-backup.age   # restore secret key
envstore link <SETUP-CODE>                       # or commit envstore.json once
envstore pull                                    # writes .env, mode 0600
envstore pull production                         # writes .env.production
```

## How it works

1. `envstore login` — OAuth (GitHub/Google) or email OTP. Server issues a
   long-lived bearer token for the CLI.
2. `envstore identity init` — generates an age keypair **locally**. The
   public recipient (e.g. `age1...`) is registered with the server; the
   secret key stays in macOS Keychain by default.
3. `envstore push` — CLI fetches every workspace member's public recipient,
   encrypts to all of them with age, uploads the ciphertext directly to R2
   via a presigned URL.
4. `envstore pull` — CLI gets a presigned download URL, fetches the
   ciphertext, and decrypts with your local secret key.

**The server only ever sees:** ciphertext bytes, public recipient strings,
metadata (size, sha256, timestamps), and bearer tokens. Lose every copy of
your secret key and your data is permanently unrecoverable — there is no
recovery flow, by design.

## Documentation

- **[Concepts](docs/concepts.md)** — workspace / project / environment /
  recipient / identity / version / token, and how they relate.
- **[Security model](docs/security-model.md)** — what zero-knowledge means
  in practice, the trust-on-first-use defense, threat scenarios.
- **[Command reference](docs/commands.md)** — every CLI command with
  synopsis, flags, and examples.

## Self-hosting

Requirements:

- Node 20.9+ (developed on Node 24)
- pnpm 11+
- Postgres ([Neon](https://neon.tech) recommended)
- Cloudflare R2 bucket
- [Resend](https://resend.com) account (optional — without it, OTP codes
  print to the dev terminal)

```sh
git clone https://github.com/michael-ketzer/envstore.xyz
cd envstore.xyz
pnpm install
cp .env.example .env
# Fill in DATABASE_URL, DIRECT_URL, AUTH_SECRET, R2_*, etc.
pnpm db:migrate
pnpm dev   # Next.js 16 dev server on http://localhost:3000
```

Deploy targets: Vercel, Fly.io, Railway, anywhere that runs Next.js 16.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the monorepo layout, conventions,
and how to run tests.

## Status

Early-stage. Core flows work end-to-end. Production-blocking gaps tracked
under [Roadmap](#roadmap).

## Roadmap

- [x] CLI: login, identity, init, link (with setup codes), ls, push, pull
- [x] Web dashboard: workspaces, projects, environments, members, invites,
      settings, account, CLI session management
- [x] Zero-knowledge model: ciphertext-only on server, age encryption,
      text-only + 1 MB cap enforcement
- [x] R2 storage with presigned URLs (split read/write planned)
- [x] Setup codes for one-command project linking
- [x] Rate limiting on auth endpoints, security headers, 90-day CLI token TTL
- [x] Paddle billing integration (checkout, webhook, trial enforcement)
- [x] Version history + rollback UI; `envstore versions` / `envstore rollback`
- [x] `envstore rekey` — re-encrypt to current recipient set
- [x] Background cron for soft-delete cleanup
- [x] Automated tests
- [x] Homebrew tap

## Security

Please see [SECURITY.md](SECURITY.md) for how to report vulnerabilities and a
description of the threat model. Our cryptographic primitives are deliberately
boring: age for end-to-end encryption, SHA-256 for hashes.

## License

[AGPL v3](LICENSE). The encrypting-decrypting CLI and the web server are both
AGPL'd. If you run a modified version as a hosted service, you have to share
your changes — that's the point.

Third-party components shipped with envstore (including the BSD 3-Clause
licensed [`age-encryption`](https://github.com/FiloSottile/typage) library
that performs all of our cryptography) are attributed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). The same file is shipped
alongside every CLI release; you can also print the bundled notices at any
time with `envstore licenses`.

envstore is not affiliated with, endorsed by, or sponsored by the age project
or its authors. We use age as a dependency under the terms of its license.

---

Built with TypeScript, Next.js 16, Auth.js v5, Prisma, Neon, Tailwind CSS,
shadcn-style components, Bun (CLI), [age-encryption](https://github.com/FiloSottile/typage).
