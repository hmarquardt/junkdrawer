---
name: junkdrawer-compliance-audit
description: Audit Junkdrawer HTML pages for convention compliance — JUNKDRAWER_DEPLOY_FOOTER presence, version sync between footer comment, data-deploy-version, and junk-drawer.json, emoji favicon, Analytics Lite inclusion rules, and valid JSON. Use before committing page changes, after bulk edits, when reviewing repo health, or when asked to check/verify project conventions.
---

# Compliance Audit

Checks every page (or one page) against the AGENTS.md conventions. Read-only — it never modifies files.

## Run it

From the repo root:

```bash
# Whole repo
.claude/skills/junkdrawer-compliance-audit/scripts/audit.sh

# Single page
.claude/skills/junkdrawer-compliance-audit/scripts/audit.sh whatshouldIeat.html
```

Exit code is non-zero if any **errors** exist; warnings never fail the run.

## What it checks

**Errors** (must fix):

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

## Fixing common findings

- Version out of sync → run the `junkdrawer-version-bump` skill's script on that file; it realigns all four locations.
- Missing analytics on a public page → add the standard snippet (see `junkdrawer-new-page` step 4) and bump the version.
- Missing JSON entry → add `title`, `description`, `emoji`, `version` (or `"hide": true`) matching the footer version.

## When to run

- After creating any new page, before committing
- After editing any existing page (at least in single-file mode)
- Periodically as a repo health check
