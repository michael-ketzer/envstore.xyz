# Security model

This page describes what envstore can and cannot do for you, in concrete
terms. The short version is in [SECURITY.md](../SECURITY.md); this is the
longer one with the threat-model details.

## The hard rule

> The server never receives, stores, or sees a key that can decrypt your
> secrets. Encryption happens on your machine; decryption happens on your
> machine. The bytes on our R2 bucket are ciphertext under X25519 +
> ChaCha20-Poly1305 (the age format), and we hold no decryption key.

Everything that follows is a consequence of that rule.

## What the server actually holds

| Data                                     | Held by server? | Used for                        |
| ---------------------------------------- | --------------- | ------------------------------- |
| Plaintext secrets                        | **No**          | —                               |
| Decryption keys                          | **No**          | —                               |
| Ciphertext blobs                         | Yes (on R2)     | Storage                         |
| Public recipients (`age1…`)              | Yes (Postgres)  | Push targets the union of these |
| Bearer tokens (sha-256 hashed)           | Yes (Postgres)  | Authenticating CLI / CI         |
| Ciphertext size, sha-256, recipientsHash | Yes (Postgres)  | Integrity check, history        |
| Push/pull timestamps, actor IDs          | Yes (Postgres)  | Audit log                       |
| Email, name, billing details             | Yes (Postgres)  | Account                         |

A full database + R2 compromise yields: a list of who pushed what to which
environment when, sizes, hashes, and the ciphertext bytes. Not the
plaintext.

## What you must protect yourself

1. **Your local identity** (`~/.config/envstore/identity.age` or macOS
   Keychain). Anyone with this file + your bearer token can decrypt your
   workspace.
2. **Your CLI bearer token** (`~/.config/envstore/credentials.json`).
   Server-side this is scoped to your user — by itself it doesn't decrypt,
   but combined with the identity it does.
3. **Backups of your identity**, in particular the password-manager copy
   you make right after `envstore identity init`. Treat it like a
   recovery-phrase: paper, password manager, hardware token.

Lose **all** copies of every member's identity and the data is gone. There
is no recovery flow on our side — the cryptography excludes us by design.

## Threat scenarios

### Server compromise (read-only)

Attacker reads the database and the R2 bucket. They see ciphertext,
metadata, audit log, bearer-token hashes (but not the raw bearers).

**What they can do:** identify which projects you have, who pushed when,
file sizes.

**What they can't do:** read your secrets, mint a token that can decrypt
your existing ciphertext, replay old plaintext.

### Server compromise (read-write, active attacker)

Attacker can return arbitrary responses to the CLI. The interesting attack
here is **adding their own recipient to the workspace** so the next push
encrypts to them.

**Defense:** [trust-on-first-use](#trust-on-first-use) — the CLI compares
the server's recipient list against the local trust cache before
encrypting. New entries pause the push and require explicit confirmation
(or `--trust-new` in CI). An attacker can still cause a "missing recipient"
denial-of-service, but cannot silently widen who decrypts your secrets.

A second, complementary defense is the read-side: the **recipientsHash**
column on every version row is computed at push time from the sorted
recipient list. If the server later swaps in different ciphertext or
misreports the hash, `envstore pull` refuses to decrypt.

### Stolen identity file

Attacker copies `identity.age` off your laptop.

**What they get:** the ability to decrypt every version encrypted to that
recipient — which, in steady state, is every active version in every
workspace you're a member of. They still need a valid bearer token to
download the ciphertext from envstore, but if they have your laptop they
likely have that too.

**Mitigation:** revoke the recipient from your account in the dashboard,
then run [`envstore rekey`](commands.md#envstore-rekey) to re-encrypt every
environment without the compromised key. Old ciphertext on R2 is still
decryptable by the leaked key — there's no way to fix that without a new
push, which is what rekey does.

### Stolen CI service token

Attacker has `ENVSTORE_TOKEN` + `ENVSTORE_IDENTITY` (or just one — but they
need both to read).

**What they can do:** with both, pull ciphertext and decrypt within the
token's project scope.

**What they can't do:** push (tokens are read-only unless you scope them
otherwise), mint other tokens, change ACLs.

**Mitigation:** revoke the token in the dashboard (immediate), then rekey
to evict the recipient.

### Lost identity, no backup

You wipe your laptop and discover you never exported the identity.

**For team workspaces:** ask a current member to add your new recipient,
then push every env again from their machine. They have plaintext (they
just decrypted it); the new push encrypts to your new key.

**For personal workspaces with no other member:** the data is gone. We
mean it. The first thing the CLI does after `identity init` is nag you to
back up — that nag is not theatre.

### Compromised laptop running a malicious envstore CLI

You install a backdoored CLI binary that copies your identity to an
attacker-controlled host. Not envstore's problem to solve — but we make it
auditable:

- The CLI is open source, AGPL v3. Build it yourself if you want.
- Release binaries are published with sha-256 sidecars. The GitHub Action
  verifies them before extracting.
- The `licenses` command embeds third-party attribution so you can spot a
  modified build that's removed the notice.

## Trust-on-first-use

Implemented in [`apps/cli/src/lib/trust.ts`](../apps/cli/src/lib/trust.ts).
The mechanics:

1. CLI fetches recipients from the server.
2. Looks up the cached set in `~/.config/envstore/trust.json` keyed by
   `(apiUrl, workspace, project)`.
3. **Cache miss** — first push from this workstation. Show the recipients
   and ask the user to confirm. After confirmation, write the cache.
4. **Cache hit, unchanged** — proceed silently.
5. **Cache hit, new entries** — flag the new recipients (label, email,
   key-kind). Wait for confirmation; in non-interactive mode require
   `--trust-new` to be set.
6. **Cache hit, removed entries** — accept silently. A removal cannot
   widen the attacker's read; if the server is removing recipients it
   means a member left or a token was revoked.

Inspect the cache with [`envstore trust list`](commands.md#envstore-trust);
reset it (forces a re-TOFU) with `envstore trust reset`.

## Crypto details

- **Asymmetric:** X25519 — keypairs are 32 bytes each, public key encoded
  with the `age1…` Bech32 string, secret with `AGE-SECRET-KEY-1…`.
- **Symmetric:** ChaCha20-Poly1305 — per-message AEAD with a fresh
  random key wrapped to each recipient's X25519 public key via X25519
  key agreement + HKDF-SHA-256.
- **Library:** [`age-encryption`](https://github.com/FiloSottile/typage),
  the upstream TypeScript port of [age](https://github.com/FiloSottile/age).
  BSD 3-Clause licensed, peer-reviewed format with no envstore-specific
  modifications.
- **Hashes:** SHA-256 everywhere (ciphertext integrity, bearer-token
  storage, recipient-set fingerprint).
- **No homemade crypto.** envstore composes vetted primitives and does not
  invent new ones.

## What we cannot offer

- **"View secret in the browser."** There is no decrypt path on the
  server. We did not build one and will not.
- **Admin password reset for your data.** No admin override. No support
  backdoor. No subpoena-compliant unlock.
- **Dynamic credentials.** Things like "mint a 1-hour Postgres password
  on demand" require a server with access to the database — which would
  require the server to hold credentials. Out of scope.
- **Plaintext audit / scanning of your secrets.** We can't grep your
  ciphertext for "looks like an AWS key" — we never see it.

If you need any of those, you need a different vendor (Doppler, Infisical,
Vault, 1Password Secrets). envstore is the option that trades those off
for the guarantee that we cannot leak what we cannot read.
