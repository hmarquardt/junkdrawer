---
name: junkdrawer-new-page
description: Create and register a new single-file HTML tool for the Junkdrawer static-site collection. Use when asked to build, add, or scaffold a new page/tool/app in this repository — covers the required emoji favicon, JUNKDRAWER_DEPLOY_FOOTER version footer, Analytics Lite tracking rules, junk-drawer.json registration, and commit/push conventions.
---

# New Junkdrawer Page

Junkdrawer pages are self-contained single-file HTML apps: inline `<style>` and `<script>` blocks, no build step, no backend, local-first data (localStorage / IndexedDB), CDN dependencies only when clearly useful.

## Workflow

### 1. Create `<tool-name>.html` in the repo root

- Semantic HTML with `aria-label` / `role` where appropriate and a `<meta name="viewport">` tag.
- One embedded `<style>` block and one embedded `<script>` block.
- Include a visible status element (`role="status"`) for async operations.
- Browser-native APIs first; keep all user data local.

### 2. Emoji favicon in `<head>`

```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪄</text></svg>" />
```

Swap in one emoji that represents the tool. (Repo favicon files like `favicon.svg` may be linked instead.)

### 3. Deploy footer before `</body>`

```html
<!-- JUNKDRAWER_DEPLOY_FOOTER version="YYYY.MM.DD.1" bump="Update this version whenever this file changes in a commit." -->
<footer data-junkdrawer-deploy-footer data-deploy-version="YYYY.MM.DD.1" style="margin: 2rem auto 1rem; padding: 1rem; text-align: center; color: rgba(148, 163, 184, 0.88); font: 0.85rem/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  &copy; 2026 Hank Marquardt · Tool Name · version YYYY.MM.DD.1
</footer>
```

Use today's date with increment `1`. The version must appear identically in all three places: comment, `data-deploy-version`, footer text.

### 4. Analytics Lite (public pages only)

Near the end of `<head>` (or before `</body>` for unusual structures):

```html
<script
  src="analytics-lite.js"
  data-site-id="junkdrawer"
  data-api="https://lab.aismallbizguru.com/api/analytics/collect"
  defer>
</script>
```

Do NOT add it to: `analytics-dashboard.html`, hidden/private/test pages, generated/vendor/example files, or pages defining their own `window.JunkStatsConfig`.

### 5. OpenRouter pages

If the tool calls OpenRouter, the settings UI must include a provider-grouped model selector — follow the `openrouter-model-selector` skill exactly. Default model: `openai/gpt-4.1-mini`.

### 6. Register in `junk-drawer.json`

Add under `pages`, version matching the footer:

```json
"filename.html": {
  "title": "Descriptive Title",
  "description": "One-sentence description of what it does.",
  "emoji": "🪄",
  "version": "YYYY.MM.DD.1"
}
```

Add `"hide": true` for private/hidden pages (title/description/emoji optional then).

### 7. Verify

Run the compliance audit (from repo root):

```bash
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh filename.html
```

It must report no errors for the new file. Also open the page in a browser (see `junkdrawer-page-testing`) and confirm it loads with no console errors.

### 8. Commit and push

Brief message, e.g. `Add <tool name>`, then push to `origin main`.

## Files involved

- `<tool-name>.html` (new)
- `junk-drawer.json` (new entry)
