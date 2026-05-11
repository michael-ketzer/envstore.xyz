#!/usr/bin/env bash
# Render the Homebrew formula for a given release, write it into the tap
# clone, commit, and push. End-to-end one-liner for shipping the brew
# formula after a GitHub release goes live.
#
# Usage:
#   bash scripts/homebrew/publish-formula.sh 0.1.1
#   bash scripts/homebrew/publish-formula.sh 0.1.1 /custom/path/to/tap
#
# Defaults to ../homebrew-envstore (sibling of this monorepo). Assumes the
# tap repo is already cloned and its current branch tracks origin.

set -euo pipefail

VERSION="${1:?usage: $0 <version-without-v> [path-to-tap]   e.g.: $0 0.1.1}"
TAP_DIR_INPUT="${2:-../homebrew-envstore}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Resolve relative tap paths against the monorepo root so the script works
# from any CWD.
if [[ "$TAP_DIR_INPUT" != /* ]]; then
  TAP_DIR="${REPO_ROOT}/${TAP_DIR_INPUT}"
else
  TAP_DIR="$TAP_DIR_INPUT"
fi

if [ ! -d "$TAP_DIR/Formula" ]; then
  cat >&2 <<EOF
error: tap clone not found at '$TAP_DIR' (no Formula/ subdirectory).

Either:
  - pass the tap path as the second argument:
      bash scripts/homebrew/publish-formula.sh $VERSION /path/to/homebrew-envstore
  - or clone it next to this monorepo:
      git clone https://github.com/michael-ketzer/homebrew-envstore.git $TAP_DIR
EOF
  exit 1
fi

FORMULA_PATH="$TAP_DIR/Formula/envstore.rb"

echo "→ rendering formula for v$VERSION" >&2
bash "$SCRIPT_DIR/render-formula.sh" "$VERSION" > "$FORMULA_PATH"

cd "$TAP_DIR"
if git diff --quiet -- Formula/envstore.rb; then
  echo "✓ formula already up to date for v$VERSION — nothing to commit." >&2
  exit 0
fi

echo "→ committing in $TAP_DIR" >&2
git add Formula/envstore.rb
git commit -m "envstore $VERSION"
git push
echo "✓ envstore $VERSION published to Homebrew tap." >&2
echo "" >&2
echo "  Users get it with: brew update && brew upgrade envstore" >&2
