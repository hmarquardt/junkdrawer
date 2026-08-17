#!/usr/bin/env bash
# bump-version.sh — bump a Junkdrawer page's JUNKDRAWER_DEPLOY_FOOTER version
# (YYYY.MM.DD.N) in the HTML file and its junk-drawer.json entry.
#
# Usage:  bump-version.sh <filename.html>
# Run from anywhere; paths resolve relative to the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
JSON="$REPO_ROOT/junk-drawer.json"

if [ $# -ne 1 ]; then
  echo "usage: $(basename "$0") <filename.html>" >&2
  exit 2
fi

FILE="$REPO_ROOT/$(basename "$1")"
BASE="$(basename "$1")"

[ -f "$FILE" ] || { echo "error: $BASE not found in $REPO_ROOT" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq is required" >&2; exit 1; }

CURRENT="$(sed -n 's/.*JUNKDRAWER_DEPLOY_FOOTER version="\([^"]*\)".*/\1/p' "$FILE" | head -1)"
if [ -z "$CURRENT" ]; then
  echo "error: $BASE has no JUNKDRAWER_DEPLOY_FOOTER comment — add one first (see junkdrawer-new-page skill)" >&2
  exit 1
fi
if ! [[ "$CURRENT" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$ ]]; then
  echo "error: current version '$CURRENT' is not YYYY.MM.DD.N" >&2
  exit 1
fi

TODAY="$(date +%Y.%m.%d)"
DATE_PART="${CURRENT%.*}"
INC="${CURRENT##*.}"
if [ "$DATE_PART" = "$TODAY" ]; then
  NEW="$TODAY.$((INC + 1))"
else
  NEW="$TODAY.1"
fi

# Replace every occurrence of the old version in the HTML file
# (covers the comment, data-deploy-version, and visible footer text).
perl -pi -e "s/\Q$CURRENT\E/$NEW/g" "$FILE"

# Update junk-drawer.json if the entry exists.
if jq -e --arg p "$BASE" '.pages | has($p)' "$JSON" >/dev/null; then
  TMP="$(mktemp)"
  jq --arg p "$BASE" --arg v "$NEW" '.pages[$p].version = $v' "$JSON" > "$TMP"
  mv "$TMP" "$JSON"
  JSON_MSG="junk-drawer.json updated"
else
  JSON_MSG="WARNING: no junk-drawer.json entry for $BASE — footer bumped only; add the entry"
fi

# Verify all three HTML locations agree with the JSON entry.
COMMENT_VER="$(sed -n 's/.*JUNKDRAWER_DEPLOY_FOOTER version="\([^"]*\)".*/\1/p' "$FILE" | head -1)"
DATA_VER="$(sed -n 's/.*data-deploy-version="\([^"]*\)".*/\1/p' "$FILE" | head -1)"
if [ "$COMMENT_VER" != "$NEW" ] || [ "$DATA_VER" != "$NEW" ]; then
  echo "error: verification failed (comment=$COMMENT_VER data=$DATA_VER expected=$NEW)" >&2
  exit 1
fi

echo "$BASE: $CURRENT -> $NEW  ($JSON_MSG)"
