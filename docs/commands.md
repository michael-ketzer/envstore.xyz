# Command reference

Every CLI command, with synopsis, flags, and examples. Anchor links jump to
each section — e.g. `commands.md#envstore-push`.

## Conventions

- `<required>` — positional argument you must supply.
- `[optional]` — positional argument you may omit.
- `--flag <value>` — flag that takes a value.
- `--flag` — boolean flag.
- All commands accept the [global flags](#global-flags) at the end.

## Global flags

| Flag              | Purpose                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `--api-url <url>` | Override the API base. Also via `ENVSTORE_API_URL` env. Useful for self-host and staging. |
| `--help`, `-h`    | Print help. Also works as `envstore help [command]`.                                      |
| `--version`, `-v` | Print the CLI version.                                                                    |

Other env vars the CLI reads:

| Var                 | Purpose                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `ENVSTORE_API_URL`  | API base URL (default: `https://envstore.xyz`).                                     |
| `ENVSTORE_TOKEN`    | Bearer token. Overrides any stored credentials.                                     |
| `ENVSTORE_IDENTITY` | Age secret key (`AGE-SECRET-KEY-1…`). Overrides the stored identity. Mainly for CI. |
| `ENVSTORE_DEBUG`    | If set, prints stack traces on errors.                                              |
| `NO_COLOR`          | Disable ANSI colors.                                                                |

---

## Auth

### envstore login

OAuth 2.0 device-authorization grant. Opens a browser to verify a short code,
then saves a long-lived bearer token locally (macOS Keychain or file).

```
envstore login
```

No flags. The CLI prints a one-time user code, opens
`https://envstore.xyz/cli` with that code pre-filled, and polls until you
approve the device.

**Gotchas**

- If the browser doesn't open, paste the URL the CLI printed. The user code
  is the same either way.
- The bearer token defaults to a 90-day expiry. Revoke any session from
  the dashboard's "CLI sessions" page; re-run `envstore login` to refresh.

### envstore logout

Wipes the local token and best-effort revokes it server-side.

```
envstore logout
```

If the server is unreachable, the local token is still wiped — the next
sign-in re-issues a fresh token.

### envstore whoami

Prints the current user, the local identity (if any), and a summary of the
linked workspace/project from `envstore.json`.

```
envstore whoami
```

Cheap check that "is my CLI configured?" before running anything that
might prompt or hit the network.

---

## Identity

### envstore identity

Local key management plus recipient registration. Subcommand-driven.

#### `identity init`

Generates a new age keypair, stores the secret half locally, registers the
public recipient with the server.

```
envstore identity init [--label <text>]
```

| Flag             | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| `--label <text>` | Human-readable name for the recipient (defaults to `hostname`). |

Refuses to clobber an existing local identity — if you really want to reset,
delete it first with `identity remove`.

#### `identity show`

Print the local public recipient (`age1…`).

```
envstore identity show
```

#### `identity export`

Back up the secret key. **Do this immediately after `init`.**

```
envstore identity export <file>          # write to a file (mode 0600)
envstore identity export --clipboard     # paste straight into a password manager
envstore identity export -               # write to stdout
```

#### `identity import`

Restore an exported secret key on another machine.

```
envstore identity import <file>
envstore identity import --clipboard
envstore identity import -               # read from stdin
```

#### `identity register`

Re-register your existing local recipient with the server. Run this after
`identity import` on a new machine if the recipient isn't already on your
account.

```
envstore identity register
```

#### `identity remove`

Wipe the local secret key. **Irreversible — make sure you have an export
first.**

```
envstore identity remove --yes
```

The `--yes` is required; this is the one place we make you confirm in argv.

---

## Project setup

### envstore init

Interactive setup. Creates a workspace and/or project on the server, then
writes `envstore.json` in the current directory.

```
envstore init [--workspace <slug>] [--project <slug>] [--name <text>] [--force] [--single]
```

| Flag                 | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `--workspace <slug>` | Skip the picker; create the workspace if it doesn't exist. |
| `--project <slug>`   | Skip the picker; create the project if it doesn't exist.   |
| `--name <text>`      | Display name for new resources (defaults to slug).         |
| `--force`            | Overwrite an existing `envstore.json`.                     |
| `--single`           | Force single-project mode even in a detected monorepo.     |

If `init` detects a monorepo (pnpm-workspace.yaml, package.json#workspaces,
or turbo.json) it offers to register every `.env*` file it finds as a
separate project in one go.

### envstore link

Write `envstore.json` for a project that already exists server-side.

```
envstore link                            # interactive picker
envstore link <workspace>/<project>      # slugs of an existing pair
envstore link <SETUP-CODE>               # 8-character code from the dashboard
```

The setup-code form is what the dashboard's "Add to project" button hands
you. In monorepo mode, link can also register additional projects from the
detected `.env*` files in one shot.

---

## Inspect

### envstore ls

Context-aware listing. Defaults to "envs in the current project" if you're
inside a linked directory; "workspaces" otherwise.

```
envstore ls                              # context-dependent
envstore ls workspaces                   # always lists workspaces
envstore ls projects [workspace]         # projects in a workspace
envstore ls envs [workspace/project]     # environments in a project
envstore ls recipients [workspace]       # who a push will encrypt to
```

`envstore ls recipients` is the quickest way to see the recipient set —
members + service tokens — before a push.

---

## Push / pull

### envstore push

Encrypt one or more files locally with age, upload the ciphertext to R2.

```
envstore push [file]                     # flat config
envstore push [path-prefix]              # multi config: filter by path
envstore push --project <slug>           # multi: filter by project slug
envstore push --env <slug>               # filter by environment
envstore push --comment "<text>"         # attach a note to the version row
envstore push --trust-new                # auto-accept new recipients (CI)
```

| Flag               | Purpose                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `--env <slug>`     | Override detected environment.                                                                            |
| `--project <slug>` | Filter by project in multi-config mode.                                                                   |
| `--comment <text>` | Stored alongside the version row, shown in audit log.                                                     |
| `--trust-new`      | Skip the recipient-diff confirmation prompt. Required in non-interactive CI when a new recipient appears. |

**Behavior depends on `envstore.json` shape:**

- **Flat config:** `envstore push` pushes `.env` by default; pass a path to
  push a different file. Environment auto-detects from the filename
  (`.env.production` → `production`); for bare `.env`/`.env.local` the CLI
  prompts the first time and persists `defaultEnv` to the config.
- **Multi config:** `envstore push` pushes every file in the config.
  Positional path is a prefix filter (`envstore push apps/web`); flags
  AND together.

**Gotchas**

- 1 MB plaintext cap. Files between 100 KB and 1 MB trigger a "are you sure
  this is an env file?" prompt.
- Text-only — anything that fails the UTF-8 check is rejected before
  encryption.
- The recipient-set check (TOFU) fires on every push. See
  [trust-on-first-use](security-model.md#trust-on-first-use).

### envstore pull

Download + decrypt one or more env files.

```
envstore pull [env]                      # flat config (default env: defaultEnv or development)
envstore pull [path-prefix]              # multi config: filter by path
envstore pull --project <slug>           # multi: filter by project
envstore pull --env <slug>               # filter by environment
envstore pull --out <path>               # custom output path (single file only)
envstore pull --version <n>              # historical version (single file only)
envstore pull --force                    # overwrite existing file
envstore pull --no-gitignore-hint        # suppress the "remember to gitignore" warning
```

| Flag                  | Purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `--env <slug>`        | Override detected environment.                                                      |
| `--project <slug>`    | Multi-config filter.                                                                |
| `--out <path>`        | Override output path. Single-file only — error if the filter matches more than one. |
| `--version <n>`       | Pull a specific historical version. Single-file only.                               |
| `--force`             | Overwrite an existing local file without prompting.                                 |
| `--no-gitignore-hint` | Don't print the "make sure this is gitignored" warning.                             |

Pulled files land with mode 0600.

**Gotchas**

- Requires a local identity. If you've moved to a new machine, run
  `identity import` first.
- Ciphertext is sha-256-checked against what the server says. A mismatch
  fails the pull — refuses to decrypt suspicious bytes.
- If your identity isn't in the version's recipient set, the decryption
  fails with a hint about asking a teammate to rekey.

---

## Per-variable

### envstore get

Print one variable's value from the latest pushed version. Decrypts in
memory; nothing touches disk.

```
envstore get <KEY>
envstore get <KEY> --env <slug>
envstore get <KEY> --project <slug> --env <slug>    # required in monorepo mode
envstore get <KEY> --newline                        # append trailing newline
```

| Flag               | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `--env <slug>`     | Which environment. Defaults to `defaultEnv` or `development`. |
| `--project <slug>` | Required in monorepo mode.                                    |
| `--newline`        | Append `\n` to the output (default: no trailing newline).     |

**Examples**

```sh
export DB_URL=$(envstore get DATABASE_URL --env staging)

# Pipe into another tool
envstore get GH_TOKEN | gh auth login --with-token
```

**Gotchas**

- No trailing newline by default — this is what makes `$(envstore get …)`
  work without trimming. Use `--newline` for human-readable terminal output.
- Errors with a non-zero exit if the key is missing or the env has no
  pushed version yet.

### envstore set

Update or add a single variable end-to-end: pull → decrypt → modify →
re-encrypt → push. Bootstraps a fresh environment if there's no version
yet.

```
envstore set <KEY>=<value>
envstore set <KEY> --from-stdin                    # read value from stdin
envstore set <KEY>=<value> --env <slug>
envstore set <KEY>=<value> --comment "<text>"
envstore set <KEY>=<value> --project <slug> --env <slug>    # required in monorepo mode
envstore set <KEY>=<value> --trust-new
```

| Flag               | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `--env <slug>`     | Target environment.                                                                        |
| `--project <slug>` | Required in monorepo mode.                                                                 |
| `--from-stdin`     | Read the value from stdin instead of argv — keeps the value out of shell history and `ps`. |
| `--comment <text>` | Stored on the new version row.                                                             |
| `--trust-new`      | Auto-accept new recipients (CI).                                                           |

**Examples**

```sh
envstore set FEATURE_FLAG=on
envstore set DATABASE_URL=postgres://localhost/dev

# Avoid leaking the value to argv:
echo -n "$SECRET_VALUE" | envstore set STRIPE_KEY --from-stdin

# Comments show up in audit log:
envstore set DATABASE_URL=postgres://new-host/db --comment "moved to managed RDS"
```

**Gotchas**

- Values with spaces, `#`, or other shell-special characters need to be
  quoted in your shell, OR use `--from-stdin`.
- `set` writes a brand-new version every time — there's no in-place edit.
  The audit log will show one push per `set`.
- Two simultaneous `set` calls produce two versions; the later one wins.
  No optimistic concurrency check today.

---

## Local hygiene

### envstore scan

Find plaintext `.env*` files tracked in git. Designed to be cheap enough
to run in a pre-commit hook.

```
envstore scan                            # default: every tracked file
envstore scan --staged                   # only what's staged for the next commit
```

| Flag       | Purpose                                                             |
| ---------- | ------------------------------------------------------------------- |
| `--staged` | Check the index, not the whole tree. Use this for pre-commit hooks. |

**Allowlisted names** (won't be flagged): `.env.example`, `.env.sample`,
`.env.template`, `.env.dist`, `.env.defaults`, plus anything whose
dot-segment contains `example`, `sample`, `template`, `dist`, or
`defaults`. `.envrc` (direnv) is ignored.

**Examples**

```sh
# One-off audit
envstore scan

# Pre-commit hook (husky / lefthook / pre-commit)
envstore scan --staged
```

Exit code is 1 if anything was flagged, so the command composes with
hook frameworks and CI gates.

### envstore genexample

Derive `.env.example` from a `.env`. Keeps comments and blank lines,
drops every value.

```
envstore genexample                      # reads .env, writes .env.example
envstore genexample [file]               # custom input path
envstore genexample --out <path>         # custom output path
envstore genexample --stdout             # print to stdout
envstore genexample --force              # overwrite an existing example
```

| Flag           | Purpose                                    |
| -------------- | ------------------------------------------ |
| `--out <path>` | Override output path.                      |
| `--stdout`     | Print to stdout instead of writing a file. |
| `--force`      | Overwrite an existing output file.         |

**Examples**

```sh
# Typical usage
envstore genexample
git add .env.example

# Per-environment template
envstore genexample .env.production
# → writes .env.production.example

# Pipe into something else
envstore genexample --stdout | grep -v INTERNAL_
```

---

## Version history

Every push appends a new immutable version to its environment, and each
environment carries a **current** pointer — that's what `envstore pull`
returns. The pointer moves forward on every push and can be moved to any
retained prior version with `rollback`. List the history with `versions`.

Each workspace has a **`versionHistoryLimit`** (default 50, configurable
5–500 in workspace settings). After every push, versions older than the cap
are pruned in the same transaction. The current pointer is always preserved
even if it falls outside the cap (e.g. after rolling back to an ancient
version), so a rollback target won't be pruned out from under you.

### envstore versions

List the version history for an environment, newest first. Marks the
version `envstore pull` would return today.

```
envstore versions [env]                  # default env: defaultEnv or development
envstore versions --env <slug>           # alternative to positional
envstore versions --project <slug>       # required in monorepo mode
```

| Flag               | Purpose                            |
| ------------------ | ---------------------------------- |
| `--env <slug>`     | Override the default environment.  |
| `--project <slug>` | Required in monorepo mode.         |

Output columns: version number, ciphertext size, push time, who pushed,
optional comment. The current version is marked with `●`. The header line
shows `<retained> retained · workspace cap: <limit>` so you know where you
sit relative to the prune threshold.

**Examples**

```sh
envstore versions                        # default env
envstore versions production
envstore versions --project api --env staging
```

### envstore rollback

Make a prior version the **current** one for an environment. Rollback is
just a pointer flip — no new version is created, no data is copied, no
re-encryption happens. Cost is O(1).

```
envstore rollback <N>                    # roll defaultEnv (or development) to vN
envstore rollback <N> --env <slug>       # specific environment
envstore rollback <N> --project <slug>   # required in monorepo mode
envstore rollback <N> --yes              # skip the confirmation prompt (CI)
```

| Flag               | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `--env <slug>`     | Target environment.                                                     |
| `--project <slug>` | Required in monorepo mode.                                              |
| `--yes`            | Skip the interactive confirmation. Required in non-interactive CI runs. |

**Examples**

```sh
# Roll the default env back to v12 (interactive — confirms first)
envstore rollback 12

# Roll production back to v7 in CI
envstore rollback 7 --env production --yes
```

**Gotchas**

- Reversible: another `rollback` flips it back. Nothing is destroyed by
  the operation itself.
- The next push from anyone in the workspace continues from the highest
  existing version number, not from the current pointer. So after rolling
  back from v20 to v12, the next push becomes v21 — and `currentVersion`
  jumps to v21 unless someone rolls back again.
- Pruned versions can't be rolled back to. If the workspace has shrunk its
  `versionHistoryLimit` and your target was pruned, it's gone — run
  `envstore versions` first to confirm the version is still retained.
- Same identity requirement as `pull`: rollback only flips a pointer
  server-side, but the version you're rolling to must still be decryptable
  by your local identity (i.e. you must be in its recipient set) for the
  next `pull` to succeed.

---

## Maintenance

### envstore rekey

Re-encrypt every reachable environment to the workspace's **current**
recipient set. Run after a teammate joins, leaves, or rotates their key,
and after revoking a service token.

```
envstore rekey                           # all envs reachable from envstore.json
envstore rekey --project <slug>          # filter by project
envstore rekey --env <slug>              # filter by environment slug
envstore rekey --dry-run                 # report what would change, don't push
envstore rekey --trust-new               # auto-accept new recipients
```

| Flag               | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `--project <slug>` | Multi-config filter.                            |
| `--env <slug>`     | Filter by environment slug across all projects. |
| `--dry-run`        | Print the plan without doing the push.          |
| `--trust-new`      | Auto-accept new recipients (CI).                |

**Behavior**

- For each env in scope: fetch the current recipient set, compare to the
  version's `recipientsHash`; skip if unchanged.
- Otherwise decrypt with your local identity, re-encrypt to the current
  set, push as a new version. Audit log records this distinctly from a
  regular push.

**Gotchas**

- Requires your local identity to be in every existing version's recipient
  set. If you weren't on the workspace when an old version was pushed, ask
  a teammate to run rekey instead.
- Doesn't delete past versions — the old ciphertext is still on R2 and
  still decryptable by the old recipients. Rekey establishes a clean
  cutoff for **future** pulls; nothing can retroactively unmake what was
  already encrypted to a leaked key.

### envstore sync

Reconcile `envstore.json` with the working tree. Useful in monorepos when
you add a new service or delete one.

```
envstore sync                            # interactive — prompts per file
envstore sync --dry-run                  # show the diff, don't write
envstore sync --yes                      # accept every suggested addition
envstore sync --yes --prune              # also drop missing entries
envstore sync --add-only                 # skip the "missing on disk" pass
envstore sync --remove-only              # skip the "new on disk" pass
```

| Flag              | Purpose                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `--dry-run`, `-n` | Print the plan, don't write.                                                                                    |
| `--yes`, `-y`     | Non-interactive — accept all proposed additions.                                                                |
| `--prune`         | Combined with `--yes`: also remove entries whose file is gone. Off by default — adds shouldn't silently delete. |
| `--add-only`      | Only propose additions.                                                                                         |
| `--remove-only`   | Only propose removals.                                                                                          |

---

## CI / service tokens

### envstore token

Manage workspace-scoped service tokens. Subcommand-driven.

#### `token create`

Mint a new service token. The bearer is shown **once** at the end of the
output — copy it then or revoke and re-mint.

```
envstore token create <name> [--workspace <slug>] [--projects <slugs>] [--expires <days>]
```

| Flag                 | Purpose                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `--workspace <slug>` | Which workspace. Defaults to the one in `envstore.json`.                                               |
| `--projects <slugs>` | Comma-separated list of project slugs the token can access. Defaults to all projects in the workspace. |
| `--expires <days>`   | Auto-expire after N days. Defaults to never.                                                           |

What you'll see:

```
✓ Created token "ci-deploy" in workspace acme.

  ENVSTORE_TOKEN=eswtok_AbCd1234…
  ENVSTORE_IDENTITY=AGE-SECRET-KEY-1XYZ…

Set both as secrets in your CI provider. The token won't be shown again.
```

The X25519 keypair is generated on **your laptop**. The server only ever
sees the public half, which is registered as a workspace recipient so
future pushes encrypt to CI alongside humans.

#### `token list`

List the workspace's active tokens.

```
envstore token list [--workspace <slug>]
```

Shows: token ID, name, scope (projects allowlist or "all"), expiry,
last-used timestamp.

#### `token revoke`

Immediately revoke a token. Existing pulls in progress complete, future
auth attempts fail.

```
envstore token revoke <id> [--workspace <slug>]
```

Run [`rekey`](#envstore-rekey) after revoking to evict the leaked
recipient from future pushes.

---

## Trust (local recipient cache)

### envstore trust

Inspect or reset the local trust cache that backs
[trust-on-first-use](security-model.md#trust-on-first-use).

```
envstore trust                           # alias for `trust list`
envstore trust list                      # show every cached (apiUrl, workspace, project) entry
envstore trust reset                     # forget the cache entry for the current project
envstore trust reset --workspace <slug>  # forget every project under one workspace
envstore trust reset --all               # wipe the entire cache
envstore trust path                      # print the cache file path
```

| Flag                 | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `--workspace <slug>` | Scope `reset` to a workspace.                                                  |
| `--all`              | Wipe everything. Requires `--yes` because the next push will silently re-TOFU. |
| `--yes`              | Confirm `--all`.                                                               |

**When to reset:**

- You're re-bootstrapping after a server migration.
- You resolved a flagged diff (e.g. confirmed a teammate's new key is
  legit) and want the cache to match the new reality.
- You're switching `--api-url` between staging and prod and the cache is
  noisy.

**When not to reset:** if you don't recognize the cached recipients,
**don't reset.** Investigate first — that's exactly what the cache is for.

---

## Misc

### envstore help

Top-level help. Also fires when you pass `--help` to any command (per-command
help isn't implemented yet — the global help has every command).

```
envstore help
envstore help [command]
envstore <command> --help
```

### envstore licenses

Prints the third-party license attributions bundled with the binary.
Same content as [`THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md) at
the repo root.

```
envstore licenses
```

The CLI is BSD-attributed because it ships
[age-encryption](https://github.com/FiloSottile/typage). The attribution
requirement comes from age's BSD 3-Clause license; this command satisfies
it for binary distributions.

---

## Exit codes

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 0    | Success.                                  |
| 1    | Generic failure (most user errors).       |
| 2    | Usage error (bad flags / missing args).   |
| 3    | Not authenticated — run `envstore login`. |
| 4    | API error (HTTP non-2xx from the server). |
| 5    | Reserved.                                 |

Pre-commit hooks and CI scripts can rely on these: `scan` exits 1 on
findings, `pull` exits 4 on auth failure, etc.
