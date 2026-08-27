---
name: junkdrawer-compliance-audit
description: Audit Junkdrawer HTML pages for convention compliance — JUNKDRAWER_DEPLOY_FOOTER presence, version sync between footer comment, data-deploy-version, and junk-drawer.json, emoji favicon, Analytics Lite inclusion rules, valid JSON, and advisory browser-storage anti-pattern warnings. Use before committing page changes, after bulk edits, when reviewing repo health, or when asked to check/verify project conventions.
---

# Compliance Audit

Checks every page (or one page) against the AGENTS.md conventions. Read-only — it never modifies files.

## Run it

From the repo root:

```bash
# Whole repo
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh

# Single page
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh whatshouldIeat.html
```

Exit code is non-zero if any **errors** exist; warnings never fail the run.

## What it checks

**Errors** (hard convention rules, must fix):

- `junk-drawer.json` is invalid JSON
- HTML file missing the `JUNKDRAWER_DEPLOY_FOOTER` comment or `<footer data-junkdrawer-deploy-footer>` element
- Version mismatch between footer comment, `data-deploy-version`, and the `junk-drawer.json` entry
- Version not matching `YYYY.MM.DD.N`
- Root-level `.html` page missing from `junk-drawer.json` entirely

**Warnings** (usually fix, some are legitimate exceptions):

- No `rel="icon"` favicon
- Public page without an `analytics-lite.js` tag (and no own `window.JunkStatsConfig`)
- Hidden (`"hide": true`) page that does include analytics
- `analytics-dashboard.html` is always exempt from analytics checks

**Storage warnings** (advisory — review prompts, not verdicts):

Static analysis cannot prove growth behavior, so storage findings are always warnings phrased as
"review storage: …". They flag obvious anti-patterns from the AGENTS.md Browser Storage
Architecture policy:

- `localStorage.setItem` on the same line as a Base64/data-URL expression (`toDataURL`,
  `readAsDataURL`, `base64`, data-URL identifiers) — Base64 payloads do not belong in localStorage
- `FileReader.readAsDataURL` present alongside a raw `localStorage.setItem` result write
- history/log/cache/corpus-like values persisted via `JSON.stringify` into localStorage —
  histories belong in IndexedDB with a retention policy
- the whole app-state object (`JSON.stringify(state)` / `appState` / `fullState`) written to
  localStorage — keep localStorage to small prefs
- very long (300+ char) `localStorage.setItem` expressions — verify the value stays small

`storage-manager.html` is exempt from storage checks (it is the inspection tool and legitimately
handles raw storage patterns).

Current noise floor: ~5 storage warnings across the whole repo (bounded histories that
legitimately live in localStorage with caps, plus two documented Remaining-Debt items). A new
warning on a fresh page is worth reading; an unbounded history in localStorage is a real defect
per AGENTS.md even though the audit reports it as advisory.

## Fixing common findings

- Version out of sync → run the `junkdrawer-version-bump` skill's script on that file; it realigns all four locations.
- Missing analytics on a public page → add the standard snippet (see `junkdrawer-new-page` step 4) and bump the version.
- Missing JSON entry → add `title`, `description`, `emoji`, `version` (or `"hide": true`) matching the footer version.
- Storage warning → consult `AGENTS.md → Browser Storage Architecture`. Move growing data to
  IndexedDB with a retention policy, keep localStorage to small bounded prefs, and never persist
  Base64/data URLs. If the pattern is legitimately bounded and small, document why and move on.

## When to run

- After creating any new page, before committing
- After editing any existing page (at least in single-file mode)
- Periodically as a repo health check
