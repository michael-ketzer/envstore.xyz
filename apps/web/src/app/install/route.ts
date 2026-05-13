// Serves the `curl -fsSL https://envstore.xyz/install | sh` installer.
// Detects OS/arch, downloads the matching binary from GitHub Releases, drops
// it on the user's PATH. Idempotent — safe to re-run for upgrades.

import { NextResponse } from 'next/server';

import { clientEnv } from '@/env.client';

const GITHUB_REPO = 'michael-ketzer/envstore.xyz';
const BINARY_NAME = 'envstore';

// Pinned minisign public key for verifying release binaries. PUBLIC info —
// safe to expose. The matching private key lives only in the
// MINISIGN_PRIVATE_KEY GitHub Actions secret used by the release workflow.
//
// Why this matters: the sha256 sidecar (.sha256) protects only against
// accidental corruption — a compromised GitHub release publisher can swap
// both the binary AND its checksum file. A minisign signature (.minisig) is
// cryptographic proof that the holder of the private key (us, OUT-OF-BAND
// from GitHub) signed the binary — flipping a release without also stealing
// our offline key then becomes detectable.
//
// Sourced from the RELEASE_SIGNING_PUBKEY env var. Format is the second line
// of a minisign `.pub` file: `RW…` followed by ~52 base64 chars. The same
// pubkey should also be committed to the repo (e.g. `RELEASE_SIGNING.pub`)
// for transparency — reviewers should be able to see at a glance what key
// the production installer is trusting.
//
// When unset (default): the script skips signature verification entirely
// and keeps the sha256-only flow working. Setting a real key flips the
// installer into "require signature" mode for every download.
//
// To enable signing for the first time:
//   1. Generate a no-password keypair locally:
//        minisign -W -G -p RELEASE_SIGNING.pub -s release.key
//   2. Commit RELEASE_SIGNING.pub to the repo (transparency).
//   3. Set the `RW…` line as RELEASE_SIGNING_PUBKEY on Vercel and redeploy.
//   4. Add the entire contents of `release.key` as the GitHub Actions secret
//      named `MINISIGN_PRIVATE_KEY`.
//   5. Cut a new release. release.yml will sign every binary; this install
//      script will start enforcing the signature.
//
// To rotate: generate a new keypair, commit the new RELEASE_SIGNING.pub,
// deploy the new env var, push the new privkey secret, cut a release. Old
// releases keep verifying under the previous pubkey if needed; archive the
// old pubkey in git history.
function releaseSigningPubkey(): string {
  return (process.env.RELEASE_SIGNING_PUBKEY ?? '').trim();
}

function script(): string {
  const pubkey = releaseSigningPubkey();
  return `#!/usr/bin/env sh
# envstore installer — https://envstore.xyz/install
# Source: https://github.com/${GITHUB_REPO}
set -eu

REPO="${GITHUB_REPO}"
BINARY="${BINARY_NAME}"

# --- Resolve OS / arch ---------------------------------------------------------
uname_s=$(uname -s)
uname_m=$(uname -m)

case "$uname_s" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux"  ;;
  *)
    echo "envstore: unsupported OS '$uname_s'. Open an issue at https://github.com/$REPO/issues" >&2
    exit 1
    ;;
esac

case "$uname_m" in
  x86_64|amd64)  ARCH="x64"   ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "envstore: unsupported architecture '$uname_m'." >&2
    exit 1
    ;;
esac

# --- Pick install destination --------------------------------------------------
# Prefer a writable system bin; otherwise fall back to ~/.local/bin and remember
# whether we need to nudge the user about PATH at the end of the install.
INSTALL_DIR="/usr/local/bin"
NEEDS_PATH_HINT=0
if [ ! -w "$INSTALL_DIR" ]; then
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  case ":$PATH:" in
    *:"$INSTALL_DIR":*) ;;
    *) NEEDS_PATH_HINT=1 ;;
  esac
fi

# --- Resolve latest release tag -------------------------------------------------
echo "envstore: fetching latest release..."
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \\
  | grep '"tag_name":' | head -n 1 | cut -d '"' -f 4)
if [ -z "$LATEST_TAG" ]; then
  echo "envstore: no public release yet — the CLI hasn't shipped. Watch the repo: https://github.com/$REPO" >&2
  exit 1
fi

ASSET="$BINARY-$OS-$ARCH"
URL="https://github.com/$REPO/releases/download/$LATEST_TAG/$ASSET"
SUMS_URL="$URL.sha256"
SIG_URL="$URL.minisig"
PUBKEY="${pubkey}"

echo "envstore: installing $LATEST_TAG ($OS/$ARCH) → $INSTALL_DIR/$BINARY"
# Stage in a temp dir so a verification failure leaves nothing on PATH.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fSL "$URL" -o "$WORK/$ASSET"
curl -fSL "$SUMS_URL" -o "$WORK/$ASSET.sha256"

# Verify the checksum sidecar against the freshly-downloaded binary before
# anything lands on PATH. The .sha256 sidecar catches accidental corruption
# but does NOT defend against a compromised release publisher who can swap
# both files — that's what the cryptographic .minisig signature below is
# for, when configured.
echo "envstore: verifying sha256 sidecar..."
( cd "$WORK"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$ASSET.sha256" >/dev/null
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$ASSET.sha256" >/dev/null
  else
    echo "envstore: cannot find sha256sum or shasum — refusing to install without verification." >&2
    exit 1
  fi
)

# --- Verify minisign signature (if pinned) ----------------------------------
# This installer pins the public key of the release-signing identity. The
# matching private key lives outside GitHub — a compromise of GitHub
# releases alone cannot forge a valid .minisig over a malicious binary.
#
# We require the signature to be present whenever a public key is pinned;
# missing-sigfile here means either a misconfigured release (caught by
# post-release smoke) or active tampering. We bail rather than skip.
if [ -n "$PUBKEY" ]; then
  echo "envstore: verifying minisign signature..."
  if ! command -v minisign >/dev/null 2>&1; then
    cat >&2 <<'MSIG_HELP'
envstore: minisign is required to verify the release signature.

  macOS:   brew install minisign
  Linux:   apt install minisign      (or:  dnf install minisign)
  Other:   https://jedisct1.github.io/minisign/

We require this because a sha256 sidecar fetched from the same place as the
binary is not enough — a compromised release can swap both files. minisign
verifies a cryptographic signature against a pinned public key, which a
GitHub-only compromise cannot forge.
MSIG_HELP
    exit 1
  fi
  curl -fSL "$SIG_URL" -o "$WORK/$ASSET.minisig"
  # -P passes the pubkey inline so we don't need a key file on disk. -q
  # silences minisign's chatter; on failure it still writes to stderr and
  # exits non-zero (which set -e propagates).
  ( cd "$WORK" && minisign -V -q -P "$PUBKEY" -m "$ASSET" -x "$ASSET.minisig" )
fi

chmod +x "$WORK/$ASSET"
mv "$WORK/$ASSET" "$INSTALL_DIR/$BINARY"

echo "envstore: installed. Run \\\`envstore login\\\` to get started."

# --- PATH hint (only if we fell back to ~/.local/bin and it isn't on PATH) ----
# Detect the user's shell so we can name the exact rc file. \${SHELL:-sh} is
# escaped here because this whole script is inside a JS template literal —
# we want the shell to evaluate it, not the JS parser.
if [ "$NEEDS_PATH_HINT" = "1" ]; then
  USER_SHELL=$(basename "\${SHELL:-sh}")
  case "$USER_SHELL" in
    zsh)  RC_FILE="\\$HOME/.zshrc" ;;
    bash) RC_FILE="\\$HOME/.bashrc" ;;
    fish) RC_FILE="\\$HOME/.config/fish/config.fish" ;;
    *)    RC_FILE="your shell's rc file" ;;
  esac
  echo ""
  echo "────────────────────────────────────────────────────────────────"
  echo "  Heads up: \\$HOME/.local/bin is not on your PATH."
  echo "  Run this so 'envstore' is found in new shells:"
  echo ""
  if [ "$USER_SHELL" = "fish" ]; then
    echo "    fish_add_path \\$HOME/.local/bin"
  else
    echo "    echo 'export PATH=\\"\\$HOME/.local/bin:\\$PATH\\"' >> $RC_FILE"
    echo "    source $RC_FILE"
  fi
  echo "────────────────────────────────────────────────────────────────"
fi
`;
}

export function GET() {
  return new NextResponse(script(), {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-source': `${clientEnv.NEXT_PUBLIC_APP_URL}/install`,
    },
  });
}
