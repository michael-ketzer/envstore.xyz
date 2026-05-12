// Serves the `curl -fsSL https://envstore.xyz/install | sh` installer.
// Detects OS/arch, downloads the matching binary from GitHub Releases, drops
// it on the user's PATH. Idempotent — safe to re-run for upgrades.

import { NextResponse } from 'next/server';

import { clientEnv } from '@/env.client';

const GITHUB_REPO = 'michael-ketzer/envstore.xyz';
const BINARY_NAME = 'envstore';

function script(): string {
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

echo "envstore: installing $LATEST_TAG ($OS/$ARCH) → $INSTALL_DIR/$BINARY"
# Stage in a temp dir so a verification failure leaves nothing on PATH.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fSL "$URL" -o "$WORK/$ASSET"
curl -fSL "$SUMS_URL" -o "$WORK/$ASSET.sha256"

# Verify the checksum sidecar against the freshly-downloaded binary before
# anything lands on PATH. The release workflow publishes the .sha256 next
# to every binary; clients (including this installer) MUST verify it —
# otherwise a hostile mirror or a MITM could swap the binary unnoticed.
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
