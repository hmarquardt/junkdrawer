# Version Bump Workflow

## When to Use

Use this skill when making changes to an existing HTML file in Junkdrawer and the version needs to be incremented.

## When to Bump

- Every commit that changes the file, even small edits
- Reset increment to `.1` on a new calendar day
- If month changes, update month and reset day+increment accordingly

## Workflow

### 1. Determine Current Version

Find the current version from the HTML file's `JUNKDRAWER_DEPLOY_FOOTER` comment:

```html
<!-- JUNKDRAWER_DEPLOY_FOOTER version="YYYY.MM.DD.N" ... -->
```

### 2. Determine New Version

Based on current date and increment:

- Same day as last version: increment N (e.g., `2026.05.09.1` → `2026.05.09.2`)
- New day: reset to `.1` (e.g., `2026.05.09.3` → `2026.05.10.1`)
- New month: update month and reset (e.g., `2026.05.31.5` → `2026.06.01.1`)

### 3. Update HTML Footer

Update both the comment and the footer element's `data-deploy-version`:

```html
<!-- JUNKDRAWER_DEPLOY_FOOTER version="YYYY.MM.DD.N" bump="Update this version whenever this file changes in a commit." -->
<footer data-junkdrawer-deploy-footer data-deploy-version="YYYY.MM.DD.N" ...>
  &copy; 2026 Hank Marquardt · Tool Name · version YYYY.MM.DD.N
</footer>
```

### 4. Update junk-drawer.json

Find the entry for the file and update its `version` field:

```json
"filename.html": {
  "title": "...",
  "description": "...",
  "emoji": "...",
  "version": "YYYY.MM.DD.N"
}
```

### 5. Verify

- HTML comment version matches HTML footer `data-deploy-version`
- HTML footer `data-deploy-version` matches JSON `version`
- Version follows `YYYY.MM.DD.N` format

### 6. Commit and Push

Commit with a brief message (e.g., "Bump version for [change description]") and push to remote.

## Files Involved

- `existing-file.html`
- `junk-drawer.json`