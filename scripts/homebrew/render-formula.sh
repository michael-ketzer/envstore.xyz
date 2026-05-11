#!/usr/bin/env bash
# Render a Homebrew formula for the given tag by substituting the version and
# the four sha256 values pulled from the GitHub release assets.
#
# Usage:
#   bash scripts/homebrew/render-formula.sh 0.1.1
#   bash scripts/homebrew/render-formula.sh 0.1.1 > ~/code/homebrew-envstore/Formula/envstore.rb
#
# The release workflow attaches *.sha256 files alongside each binary — this
# script fetches them, drops the values into envstore.rb.template, and prints
# the rendered formula to stdout. Pipe it into Formula/envstore.rb in your
# homebrew-envstore clone, commit, and push.

set -euo pipefail

VERSION="${1:?usage: $0 <version-without-v>   e.g.: $0 0.1.1}"
REPO="michael-ketzer/envstore.xyz"
TAG="v${VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/envstore.rb.template"

if [ ! -f "$TEMPLATE" ]; then
  echo "error: template not found at $TEMPLATE" >&2
  exit 1
fi

# Fetch a single sha256 file from the GitHub release and emit only the hex digest.
fetch_sha() {
  local asset="$1"
  curl -fsSL "https://github.com/${REPO}/releases/download/${TAG}/envstore-${asset}.sha256" \
    | awk '{print $1}'
}

echo "fetching sha256 values for ${TAG}…" >&2
DARWIN_ARM=$(fetch_sha darwin-arm64)
DARWIN_X64=$(fetch_sha darwin-x64)
LINUX_ARM=$(fetch_sha linux-arm64)
LINUX_X64=$(fetch_sha linux-x64)

for sha in "$DARWIN_ARM" "$DARWIN_X64" "$LINUX_ARM" "$LINUX_X64"; do
  if [ -z "$sha" ] || [ "${#sha}" -ne 64 ]; then
    echo "error: invalid sha256 digest fetched: '$sha'" >&2
    exit 1
  fi
done

sed \
  -e "s|VERSION|${VERSION}|" \
  -e "s|SHA256_DARWIN_ARM64|${DARWIN_ARM}|" \
  -e "s|SHA256_DARWIN_X64|${DARWIN_X64}|" \
  -e "s|SHA256_LINUX_ARM64|${LINUX_ARM}|" \
  -e "s|SHA256_LINUX_X64|${LINUX_X64}|" \
  "$TEMPLATE"
