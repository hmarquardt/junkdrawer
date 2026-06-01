# New Page Workflow

## When to Use

Use this skill when asked to create a new single-file HTML tool for Junkdrawer.

## Workflow

### 1. Create the HTML File

Create a new `.html` file in the repository root with:
- Semantic HTML structure with appropriate `aria-label` and `role` attributes
- Single embedded `<style>` block for CSS
- Single embedded `<script>` block for JavaScript
- No external build step

### 2. Add Favicon

In the `<head>`, add an emoji favicon:

```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪄</text></svg>" />
```

Use a single emoji relevant to the tool.

### 3. Add JUNKDRAWER_DEPLOY_FOOTER

Before the closing `</body>` tag, add:

```html
<!-- JUNKDRAWER_DEPLOY_FOOTER version="YYYY.MM.DD.1" bump="Update this version whenever this file changes in a commit." -->
<footer data-junkdrawer-deploy-footer data-deploy-version="YYYY.MM.DD.1" style="margin: 2rem auto 1rem; padding: 1rem; text-align: center; color: rgba(148, 163, 184, 0.88); font: 0.85rem/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  &copy; 2026 Hank Marquardt · Tool Name · version YYYY.MM.DD.1
</footer>
```

Replace `YYYY.MM.DD.1` with the current date and `1` (use today's date, increment starts at 1). Replace `Tool Name` with the display name of the tool.

### 4. Add Analytics Lite

For public user-facing pages, add the Analytics Lite / JunkStats tracker near the end of `<head>`:

```html
<script
  src="analytics-lite.js"
  data-site-id="junkdrawer"
  data-api="https://lab.aismallbizguru.com/api/analytics/collect"
  defer>
</script>
```

Skip this for hidden/private/test pages, `analytics-dashboard.html`, generated/vendor/example files, or pages that already include `analytics-lite.js` or an equivalent custom `window.JunkStatsConfig`.

### 5. Add Entry to junk-drawer.json

Open `junk-drawer.json` and add a new entry under `pages`:

```json
"filename.html": {
  "title": "Descriptive Title",
  "description": "One-sentence description of what it does.",
  "emoji": "🪄",
  "version": "YYYY.MM.DD.1"
}
```

Match the version from step 3. Use a single emoji for `emoji`.

### 6. Verify

- Confirm the HTML file has no syntax errors
- Confirm `junk-drawer.json` is valid JSON
- Confirm favicon, footer comment, footer element, and JSON entry all match and use the same version
- Confirm public user-facing pages include exactly one `analytics-lite.js` script tag, and hidden/private/dashboard pages do not

### 7. Commit and Push

Commit with a brief message (e.g., "Add [tool name]") and push to remote.

## Files Involved

- `new-tool.html` (the new file)
- `junk-drawer.json`
