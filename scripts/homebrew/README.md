# Homebrew tap setup

These files live in **this repo** for visibility, but the actual tap is a
separate GitHub repo named `michael-ketzer/homebrew-envstore`. Homebrew requires that
naming convention.

## One-time setup

```sh
# 1. Create an empty GitHub repo: michael-ketzer/homebrew-envstore
# 2. Clone it locally
git clone https://github.com/michael-ketzer/homebrew-envstore
cd homebrew-envstore

# 3. Create the Formula directory
mkdir -p Formula

# 4. Copy our template
cp /path/to/envstore.xyz/scripts/homebrew/envstore.rb.template Formula/envstore.rb

# 5. Fill in the placeholders (VERSION, SHA256_*) for your first release
# 6. Commit + push
git add Formula/envstore.rb
git commit -m "Initial envstore formula"
git push
```

After that:

```sh
brew tap michael-ketzer/envstore
brew install envstore
```

## Per-release update

After each `git tag v0.x.y && git push --tags` on `envstore.xyz`:

1. Wait for the release workflow to finish and attach the binaries +
   `*.sha256` files to the GitHub release.
2. Run the publish helper. It renders the formula from the release's sha256
   values, writes it into the tap clone, then commits and pushes:

   ```sh
   bash scripts/homebrew/publish-formula.sh 0.x.y
   ```

   Defaults to `../homebrew-envstore` next to this monorepo; pass a path
   as the second arg if your clone lives elsewhere.

Existing users get the upgrade with `brew upgrade envstore` — no re-tap needed.

The helper is layered: `render-formula.sh` just prints the rendered formula
to stdout (useful for inspecting a diff), and `publish-formula.sh` wraps it
with the tap-write + commit + push.

## Why a separate repo?

Homebrew's tap discovery looks for repos named `homebrew-<tap>`. Putting the
formula in this monorepo wouldn't work for `brew tap michael-ketzer/envstore`.

## Automating this later

A natural follow-up is a GitHub Action on `envstore.xyz` that, after a
successful `release.yml` run, opens a PR on `homebrew-envstore` updating the
formula. Out of scope for now.
