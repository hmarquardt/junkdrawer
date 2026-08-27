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

# storage-manager.html legitimately displays/inspects raw storage patterns;
# analytics-dashboard.html is exempt everywhere.
check_storage() {
  F="$1"
  [ "$F" = "storage-manager.html" ] && return 0
  local seen_base64=0 seen_history=0 seen_state=0 seen_url=0

  # localStorage.setItem whose value mentions a data-URL/base64-producing call
  # (same line only — cross-line flow is beyond static analysis).
  if grep -nE 'localStorage\.setItem\([^)]*(toDataURL|readAsDataURL|base64|dataURL|dataUrl)' "$F" >/dev/null 2>&1; then
    warn "review storage: localStorage.setItem near a Base64/data-URL expression (line $(grep -nE 'localStorage\.setItem\([^)]*(toDataURL|readAsDataURL|base64|dataURL|dataUrl)' "$F" | head -1 | cut -d: -f1)) — Base64 payloads do not belong in localStorage"
    seen_base64=1
  fi

  # readAsDataURL whose result reaches localStorage.setItem on the same line
  if grep -nE 'localStorage\.setItem\([^)]*result' "$F" >/dev/null 2>&1 && grep -nE 'readAsDataURL' "$F" >/dev/null 2>&1; then
    warn "review storage: FileReader.readAsDataURL present alongside raw localStorage.setItem — verify image data is not persisted to localStorage"
  fi

  # history/log/cache-like key persisted wholesale via JSON.stringify
  local hl
  hl="$(grep -nE 'localStorage\.setItem\([^)]*(history|History|log|Log|cache|Cache|corpus|Corpus)[^)]*,\s*JSON\.stringify' "$F" | head -1)"
  if [ -n "$hl" ]; then
    warn "review storage: history-like data persisted to localStorage ($(echo "$hl" | cut -d: -f1)) — histories belong in IndexedDB with a retention policy"
    seen_history=1
  fi

  # whole app-state blob writes (the entire state object, not a settings sub-object)
  local sl
  sl="$(grep -nE 'localStorage\.setItem\([^)]*,\s*JSON\.stringify\((state|appState|fullState)\)\s*\)' "$F" | head -1)"
  if [ -n "$sl" ]; then
    warn "review storage: whole app-state object serialized to localStorage ($(echo "$sl" | cut -d: -f1)) — keep localStorage to small prefs; large state belongs in IndexedDB"
    seen_state=1
  fi

  # large-ish persisted blobs: a localStorage.setItem carrying a very long
  # string literal (heuristic for inlining a big payload). Long *lines* are
  # normal in minified code, so match the literal length, not the line length.
  # perl handles {300,}; BSD grep caps repetitions at 255.
  local longlit
  longlit="$(perl -ne 'if (/localStorage\.setItem\(/ && /["'"'"'][^"'"'"']{300,}["'"'"']/) { print "$.\n"; exit }' "$F" 2>/dev/null | head -1)"
  if [ -n "$longlit" ]; then
    warn "review storage: very long string literal passed to localStorage.setItem (line $longlit) — verify the value stays small and bounded"
  fi
  return 0
}

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

  # --- storage anti-patterns (advisory warnings; static analysis cannot prove
  #     growth behavior — treat these as review prompts, not verdicts) ---
  check_storage "$F"

  [ -n "$COMMENT_VER" ] && echo "  version $COMMENT_VER${JSON_VER:+ (json: $JSON_VER)}${HIDDEN:+ hidden=$HIDDEN}"
done

echo
echo "== summary: $ERRORS error(s), $WARNINGS warning(s) =="
[ "$ERRORS" -gt 0 ] && exit 1
exit 0
