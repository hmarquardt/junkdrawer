---
name: junkdrawer-version-bump
description: Increment a Junkdrawer page's version after editing it. Use whenever an existing HTML file in this repo is modified in a commit — keeps the JUNKDRAWER_DEPLOY_FOOTER comment, footer data-deploy-version, footer text, and junk-drawer.json entry in sync using the YYYY.MM.DD.N format. Includes a helper script that performs the whole bump automatically.
---

# Version Bump

Every commit that changes an HTML page must bump that page's version in **four places**: the footer HTML comment, the footer's `data-deploy-version` attribute, the footer's visible text, and the `junk-drawer.json` entry.

## Version rules

Format: `YYYY.MM.DD.N`

- Same calendar day as the current version → increment N (`2026.05.09.1` → `2026.05.09.2`)
- New day → reset to `.1` (`2026.05.09.3` → `2026.05.10.1`)
- New month/year → update those parts and reset (`2026.05.31.5` → `2026.06.01.1`)

Compare against the version in the file's `JUNKDRAWER_DEPLOY_FOOTER` comment, not against `junk-drawer.json`.

## Fast path: helper script

From the repo root:

```bash
.agents/skills/junkdrawer-version-bump/scripts/bump-version.sh <filename.html>
```

The script computes the new version from today's date, rewrites all occurrences of the old version in the HTML file (comment, attribute, footer text), updates `junk-drawer.json` via `jq`, and verifies the result. It refuses to run if the file has no `JUNKDRAWER_DEPLOY_FOOTER` comment.

## Manual path

1. Read the current version from `<!-- JUNKDRAWER_DEPLOY_FOOTER version="OLD" ... -->`.
2. Compute NEW per the rules above.
3. Replace OLD with NEW everywhere it appears in the footer area of the HTML file.
4. Set `"version": "NEW"` on the file's entry in `junk-drawer.json` (create the entry if missing — a page without an entry is itself a convention violation).
5. Verify: comment version == `data-deploy-version` == JSON version, all matching `YYYY.MM.DD.N`.

## Verify and ship

```bash
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh <filename.html>
git add <filename.html> junk-drawer.json
git commit -m "Bump version for <change description>" && git push
```

## Notes

- Only HTML pages carry deploy footers. Do not invent versions for `.md`, `.js`, or skill files.
- If several pages change in one commit, bump each of them.
- Never decrement or reuse a version; when in doubt, increment.
