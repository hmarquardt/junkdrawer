#!/usr/bin/env bash
# audit.sh — check Junkdrawer HTML pages against AGENTS.md conventions.
#
# Usage:  audit.sh              # audit every root-level *.html page
#         audit.sh <file.html>  # audit one page
#
# Read-only. Exit code 1 if any errors are found; warnings never fail the run.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Walk up from this script to find the repo root (the dir holding junk-drawer.json),
# so the script works from .agents/skills/, via .claude/skills/ symlinks, or copies.
REPO_ROOT="$SCRIPT_DIR"
while [ "$REPO_ROOT" != "/" ] && [ ! -f "$REPO_ROOT/junk-drawer.json" ]; do
  REPO_ROOT="$(dirname "$REPO_ROOT")"
done
if [ ! -f "$REPO_ROOT/junk-drawer.json" ]; then
  echo "error: could not locate junk-drawer.json above $SCRIPT_DIR" >&2
  exit 1
fi
JSON="$REPO_ROOT/junk-drawer.json"
cd "$REPO_ROOT" || exit 1

command -v jq >/dev/null || { echo "error: jq is required" >&2; exit 1; }

ERRORS=0
WARNINGS=0
err()  { echo "  ERROR   $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  warning $1"; WARNINGS=$((WARNINGS + 1)); }

echo "== junk-drawer.json =="
if ! jq empty "$JSON" 2>/dev/null; then
  err "junk-drawer.json is not valid JSON"
  echo; echo "Audit aborted: fix the JSON first."
  exit 1
fi
echo "  ok      valid JSON"

if [ $# -ge 1 ]; then
  FILES="$(basename "$1")"
else
  FILES="$(ls *.html 2>/dev/null)"
fi

for F in $FILES; do
  [ -f "$F" ] || { echo; echo "== $F =="; err "file not found"; continue; }
  echo; echo "== $F =="

  COMMENT_VER="$(sed -n 's/.*JUNKDRAWER_DEPLOY_FOOTER version="\([^"]*\)".*/\1/p' "$F" | head -1)"
  DATA_VER="$(sed -n 's/.*data-deploy-version="\([^"]*\)".*/\1/p' "$F" | head -1)"
  HAS_FOOTER_EL="$(grep -c 'data-junkdrawer-deploy-footer' "$F" || true)"
  HAS_FAVICON="$(grep -c 'rel="icon"' "$F" || true)"
  HAS_ANALYTICS="$(grep -c 'analytics-lite.js' "$F" || true)"
  HAS_OWN_STATS="$(grep -c 'JunkStatsConfig' "$F" || true)"

  IN_JSON="$(jq -r --arg p "$F" 'if .pages | has($p) then "yes" else "no" end' "$JSON")"
  JSON_VER="$(jq -r --arg p "$F" '.pages[$p].version // empty' "$JSON")"
  HIDDEN="$(jq -r --arg p "$F" '.pages[$p].hide // false' "$JSON")"

  # --- footer + version sync (errors) ---
  if [ -z "$COMMENT_VER" ]; then
    err "missing JUNKDRAWER_DEPLOY_FOOTER comment"
  elif ! [[ "$COMMENT_VER" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$ ]]; then
    err "version '$COMMENT_VER' is not YYYY.MM.DD.N"
  fi
  [ "$HAS_FOOTER_EL" -eq 0 ] && err "missing <footer data-junkdrawer-deploy-footer> element"
  if [ -n "$COMMENT_VER" ] && [ -n "$DATA_VER" ] && [ "$COMMENT_VER" != "$DATA_VER" ]; then
    err "footer comment ($COMMENT_VER) != data-deploy-version ($DATA_VER)"
  fi
  if [ "$IN_JSON" = "no" ]; then
    err "no junk-drawer.json entry"
  elif [ -n "$COMMENT_VER" ] && [ -n "$JSON_VER" ] && [ "$COMMENT_VER" != "$JSON_VER" ]; then
    err "footer version ($COMMENT_VER) != junk-drawer.json version ($JSON_VER)"
  fi

  # --- favicon (warning) ---
  [ "$HAS_FAVICON" -eq 0 ] && warn "no rel=\"icon\" favicon found"

  # --- analytics rules (warnings) ---
  if [ "$F" != "analytics-dashboard.html" ]; then
    if [ "$HIDDEN" = "true" ] && [ "$HAS_ANALYTICS" -gt 0 ]; then
      warn "hidden page includes analytics-lite.js"
    elif [ "$HIDDEN" != "true" ] && [ "$HAS_ANALYTICS" -eq 0 ] && [ "$HAS_OWN_STATS" -eq 0 ]; then
      warn "public page has no analytics-lite.js (and no own JunkStatsConfig)"
    fi
  fi

  [ -n "$COMMENT_VER" ] && echo "  version $COMMENT_VER${JSON_VER:+ (json: $JSON_VER)}${HIDDEN:+ hidden=$HIDDEN}"
done

echo
echo "== summary: $ERRORS error(s), $WARNINGS warning(s) =="
[ "$ERRORS" -gt 0 ] && exit 1
exit 0
