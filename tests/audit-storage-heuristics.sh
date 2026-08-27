#!/usr/bin/env bash
# tests/audit-storage-heuristics.sh — unit tests for the storage anti-pattern
# warnings in the compliance audit script (audit.sh).
#
# Builds small fixture HTML files, runs audit.sh against them, and asserts the
# expected advisory warnings fire (or stay silent). Read-only on repo files;
# fixtures are created in the repo root (audit.sh resolves paths from there)
# and removed afterward.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT="$REPO_ROOT/.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh"
cd "$REPO_ROOT" || exit 1

PASS=0
FAIL=0

# Fixtures must live in the repo root for audit.sh's basename resolution.
TMP1=".tmp-heuristic-fixture.html"
JSON_BACKUP=""

cleanup() {
  rm -f "$TMP1"
  if [ -n "$JSON_BACKUP" ] && [ -f "$JSON_BACKUP" ]; then
    mv "$JSON_BACKUP" "$REPO_ROOT/junk-drawer.json"
  fi
}
trap cleanup EXIT

# Register the fixture in junk-drawer.json (with footer + version) so the
# exit-code test exercises warnings only. Backup is restored in cleanup.
register_fixture() {
  JSON_BACKUP="$REPO_ROOT/.tmp-junk-drawer.backup.json"
  cp "$REPO_ROOT/junk-drawer.json" "$JSON_BACKUP"
  python3 - "$TMP1" << 'PYEOF'
import json, sys
name = sys.argv[1]
with open('junk-drawer.json') as f:
    data = json.load(f)
data['pages'][name] = {"title": "Heuristic Fixture", "description": "temp", "emoji": "🧪", "version": "2026.01.01.1"}
with open('junk-drawer.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
PYEOF
}

run_audit() { . "$AUDIT" "$TMP1" >/dev/null 2>&1; }

# run_case <name> <fixture-html> <expect|reject> <warning-substring>
run_case() {
  local name="$1" fixture="$2" mode="$3" needle="$4"
  printf '%s' "$fixture" > "$TMP1"
  local out
  out="$(bash "$AUDIT" "$TMP1" 2>&1)"
  if [ "$mode" = "expect" ]; then
    if echo "$out" | grep -q "$needle"; then
      PASS=$((PASS + 1)); echo "ok       $name"
    else
      FAIL=$((FAIL + 1)); echo "FAIL     $name (expected warning containing: $needle)"
      echo "---- audit output ----"; echo "$out" | sed 's/^/  /'
    fi
  else
    if echo "$out" | grep -q "review storage"; then
      FAIL=$((FAIL + 1)); echo "FAIL     $name (expected no storage warnings)"; echo "$out" | grep "review storage" | sed 's/^/  /'
    else
      PASS=$((PASS + 1)); echo "ok       $name"
    fi
  fi
}

# 1. Base64/data-URL near localStorage.setItem → warn
run_case "base64 data URL persisted to localStorage is flagged" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
function save(canvas){ localStorage.setItem("t.preview", canvas.toDataURL("image/jpeg", 0.7)); }
</script></body></html>' \
expect "Base64"

# 2. history-like JSON blob → warn
run_case "history-like localStorage blob is flagged" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
function save(){ localStorage.setItem("t.history", JSON.stringify(history)); }
</script></body></html>' \
expect "history-like"

# 3. whole app-state blob → warn
run_case "whole app-state blob is flagged" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
function save(){ localStorage.setItem("t.state", JSON.stringify(state)); }
</script></body></html>' \
expect "app-state"

# 4. long inline setItem expression → warn
LONG_XS="$(printf 'x%.0s' $(seq 1 400))"
run_case "very long setItem expression is flagged" \
"<!DOCTYPE html><html><head><title>t</title></head><body><script>
localStorage.setItem(\"t.big\", JSON.stringify({a:'$LONG_XS'}));
</script></body></html>" \
expect "very long string literal"

# 5. benign small prefs → silent
run_case "benign preference-only page is silent" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
localStorage.setItem("t.theme", "dark");
localStorage.setItem("t.model", "openai/gpt-4.1-mini");
try { localStorage.setItem("t.flag", String(enabled)); } catch (e) {}
</script></body></html>' \
reject ""

# 6. guarded jd-storage-style writes of a settings object → silent
run_case "jd-storage guarded settings write is silent" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
JDStorage.setJSON("t.settings.v1", settings, { evict: shrinkSettings });
</script></body></html>' \
reject ""

# 7. history in IndexedDB → silent
run_case "IndexedDB history storage is silent" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
const req = indexedDB.open("t-db", 1);
req.onupgradeneeded = () => req.result.createObjectStore("history", { keyPath: "id" });
function saveHistory(){ const tx = db.transaction("history","readwrite"); tx.objectStore("history").put(record); }
</script></body></html>' \
reject ""

# 8. settings sub-object (state.settings) → silent (narrowed state heuristic)
run_case "small settings sub-object write is silent" \
'<!DOCTYPE html><html><head><title>t</title></head><body><script>
localStorage.setItem("t.settings", JSON.stringify(state.settings));
</script></body></html>' \
reject ""

# 9. warnings never fail the audit run (exit code stays 0 for a registered page)
printf '%s' '<!DOCTYPE html><html><head><title>t</title><link rel="icon" href="data:image/svg+xml,<svg xmlns='"'"'http://www.w3.org/2000/svg'"'"' viewBox='"'"'0 0 100 100'"'"'><text y='"'"'.9em'"'"' font-size='"'"'90'"'"'>🧪</text></svg>" /></head><body><script>
localStorage.setItem("t.history", JSON.stringify(history));
</script>
<!-- JUNKDRAWER_DEPLOY_FOOTER version="2026.01.01.1" bump="x" -->
<footer data-junkdrawer-deploy-footer data-deploy-version="2026.01.01.1">Heuristic Fixture</footer>
</body></html>' > "$TMP1"
register_fixture
if bash "$AUDIT" "$TMP1" >/dev/null 2>&1; then
  PASS=$((PASS + 1)); echo "ok       storage warnings do not fail the audit exit code"
else
  FAIL=$((FAIL + 1)); echo "FAIL     storage warnings must not fail the audit exit code"
fi

echo
echo "== heuristic tests: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
