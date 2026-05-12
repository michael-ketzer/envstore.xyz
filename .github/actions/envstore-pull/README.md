# envstore-pull

Composite GitHub Action that downloads the envstore CLI, authenticates with a
workspace service token, and runs `envstore pull` to materialize encrypted
`.env` files in the runner's workspace.

## Setup

1. Mint a service token on a machine where you're signed in as a workspace
   admin:

   ```
   envstore token create ci-prod --workspace <your-workspace>
   ```

   The CLI prints two values exactly once. Save them as repository secrets:
   - `ENVSTORE_TOKEN` — the bearer (starts with `eswtok_`)
   - `ENVSTORE_IDENTITY` — the age private key (starts with `AGE-SECRET-KEY-`)

2. Commit `envstore.json` to your repo (the CLI's `init`/`link` writes this).

## Usage

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: michael-ketzer/envstore.xyz/.github/actions/envstore-pull@v0.5.0
        with:
          token: ${{ secrets.ENVSTORE_TOKEN }}
          identity: ${{ secrets.ENVSTORE_IDENTITY }}
          # Optional — defaults are listed in action.yml
          env: production
          # project: my-app           # required only for monorepo configs
          # out: .env.local           # override output path
          # version: 0.5.0            # pin the CLI version

      - run: ./deploy.sh
```

## What gets installed

The action downloads the pinned (or latest) release binary from
`github.com/michael-ketzer/envstore.xyz/releases`, verifies its SHA-256 against
the `.sha256` sidecar published with the release, and adds the binary
directory to `PATH` for subsequent steps.

Linux x64 and macOS arm64 runners are supported. Windows isn't.

## Security model

Service tokens are workspace-scoped read+write credentials. A leaked token
could pull all of your workspace's encrypted env files until you revoke it.
Tokens cannot escalate to other workspaces, cannot mint more tokens, and
cannot change member roles — the API path checks this explicitly.

Rotate tokens regularly. `envstore token list` shows last-used timestamps;
`envstore token revoke <id>` invalidates a token immediately.
