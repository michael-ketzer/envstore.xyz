// Serves the `curl -fsSL https://envstore.xyz/install | sh` installer.
// Detects OS/arch, downloads the matching binary from GitHub Releases, drops
// it on the user's PATH. Idempotent — safe to re-run for upgrades.

import { NextResponse } from 'next/server';

import { clientEnv } from '@/env.client';

const GITHUB_REPO = 'mketzer/envstore.xyz';
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
INSTALL_DIR="/usr/local/bin"
if [ ! -w "$INSTALL_DIR" ]; then
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  case ":$PATH:" in
    *:"$INSTALL_DIR":*) ;;
    *)
      echo "envstore: \\$HOME/.local/bin is not on your PATH. Add it to your shell rc:"
      echo "    export PATH=\\"\\$HOME/.local/bin:\\$PATH\\""
      ;;
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

echo "envstore: installing $LATEST_TAG ($OS/$ARCH) → $INSTALL_DIR/$BINARY"
TMP=$(mktemp)
curl -fSL "$URL" -o "$TMP"
chmod +x "$TMP"
mv "$TMP" "$INSTALL_DIR/$BINARY"

echo "envstore: installed. Run \\\`envstore login\\\` to get started."
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
