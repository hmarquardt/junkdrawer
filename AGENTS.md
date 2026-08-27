# Junkdrawer Agent Guide

## Project Context

Junkdrawer is a personal collection of local-first browser tools. Most are single-file HTML applications with no build step, no server, and no external tracking. They rely on browser APIs (IndexedDB, WebRTC, WebSockets, WebGPU, etc.) and lightweight CDN dependencies for specific libraries.

## Role

You are a full-stack generalist: comfortable with architecture, frontend UX, and backend logic. You weigh tradeoffs across all three — preferring simplicity, local operation, and minimal dependencies. You write code that feels at home in a browser and respects user privacy.

## Conventions for New Files

### 1. Add to `junk-drawer.json`

Every new page entry must be added to `junk-drawer.json` under the `pages` key with at minimum:

```json
"filename.html": {
  "title": "Descriptive Title",
  "description": "One-sentence description of what it does.",
  "emoji": "🪄",
  "version": "YYYY.MM.DD.1"
}
```

The `emoji` should be a single emoji that represents the tool. The `version` field uses the `JUNKDRAWER_DEPLOY_FOOTER` version (see below).

### 2. Favicon

Add an emoji favicon in the `<head>` of the HTML file:

```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪄</text></svg>" />
```

Alternatively, link to local favicon files if they exist (e.g., `favicon.svg`, `favicon-96x96.png`).

### 3. Copyright and Versioning Footer

Every HTML file must include a machine-discoverable footer using the `JUNKDRAWER_DEPLOY_FOOTER` pattern. This allows agents to detect and increment versions reliably.

**Add this comment at the top of the footer (before the `<footer>` element):**

```html
<!-- JUNKDRAWER_DEPLOY_FOOTER version="YYYY.MM.DD.1" bump="Update this version whenever this file changes in a commit." -->
```

**Add the footer element itself, using inline styles consistent with the rest of the project:**

```html
<footer data-junkdrawer-deploy-footer data-deploy-version="YYYY.MM.DD.1" style="margin: 2rem auto 1rem; padding: 1rem; text-align: center; color: rgba(148, 163, 184, 0.88); font: 0.85rem/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  &copy; 2026 Hank Marquardt · Tool Name · version YYYY.MM.DD.1
</footer>
```

#### Version Format and Increment Rules

- **Format**: `YYYY.MM.DD.N` — year, month, day, and a daily increment starting at 1
- **When to bump**:
  - Increment the final number whenever you commit a change to that file (even small edits)
  - Reset the increment to `.1` on a new calendar day
  - If the month changes, update month and reset day+increment accordingly
- **Examples**: `2026.05.09.1` → `2026.05.09.2` (same day, next commit) → `2026.05.10.1` (next day)
- **Agent instruction**: When making changes to an existing file, always increment the version number in both the HTML footer and the `junk-drawer.json` entry.

### 4. Update `junk-drawer.json` Version

When you update a file's footer version, also update the corresponding entry in `junk-drawer.json` to match.

### 5. Analytics Lite

Public user-facing pages should include the local Analytics Lite / JunkStats tracker. Add this script tag near the end of `<head>` when the page has a normal head section, or before `</body>` if the structure is unusual:

```html
<script
  src="analytics-lite.js"
  data-site-id="junkdrawer"
  data-api="https://lab.aismallbizguru.com/api/analytics/collect"
  defer>
</script>
```

Do not add analytics to `analytics-dashboard.html`, hidden/private/test pages, generated/vendor/example files, or pages that already include `analytics-lite.js` or define their own equivalent `window.JunkStatsConfig`.

### 6. OpenRouter Model Selection

Pages that use OpenRouter should provide a user-configurable model selector instead of hard-coding a single model in the UI.

- Store the user's OpenRouter API key and selected model locally only. Keys and the selected model are small, stable preferences: `localStorage` (guarded per the Browser Storage Architecture section) is fine; a fetched model catalog is a re-creatable cache — keep it small and bounded, or put it in IndexedDB.
- Use a default model when no setting exists: `openai/gpt-4.1-mini`.
- Once an OpenRouter key is entered or saved, fetch available models from `https://openrouter.ai/api/v1/models` using the user's key.
- Populate the model control as a `<select>` grouped by provider with `<optgroup>` labels. For standard OpenRouter IDs, use the prefix before `/` as the provider, e.g. `openai/gpt-4.1-mini` groups under `openai`.
- Preserve the current or previously saved model as a fallback option if it is not returned by the model list.
- Include a manual "Refresh models" action and a visible status/error element for model loading.
- Do not fetch models until the user has provided a key. Do not make hidden OpenRouter calls beyond model-list loading and explicit AI actions.
- If model loading fails, keep the saved/default model usable and show a clear error rather than blocking the page.

## Browser Storage Architecture

All Junkdrawer pages are served from one GitHub Pages origin, so they **share one browser storage
budget**. Quota pressure is cumulative: one page can fill storage and cause quota failures in
completely unrelated pages. Storage design is a repository-wide concern. Full audit and per-app
classifications: `docs/storage-audit-2026-08.md`; live inspection tool: `storage-manager.html`.

### Choose the mechanism by data shape, not habit

- **Small, stable, bounded** (prefs, UI state, selected model, feature flags, last-used options,
  tiny migration markers) → `localStorage`. An app's total localStorage footprint should be
  **kilobytes, not megabytes**.
- **Growing, structured, or large** (histories, logs, evaluation records, observations, imported
  documents, corpora, cached API/model-catalog responses, AI outputs, images, audio, blobs,
  data URLs) → **IndexedDB**, using record-oriented object stores — not one giant JSON blob.

Never store in localStorage: unbounded histories, Base64/data-URL payloads (especially images and
audio), imported documents, raw API responses, model catalogs, or whole app-state snapshots.

### Growth policy

Every structure that can grow must have an intentional model: **STATIC**, **BOUNDED** (max record
count or byte budget), **AGE-PRUNED** (max age), or **USER-MANAGED** (explicit delete/clear UI).
Avoid UNBOUNDED/UNKNOWN. For high-volume or bursty data prefer two-dimensional retention — a
maximum age **and** a hard record-count cap (e.g. "no older than 30 days AND ≤ 5,000 records").
Never auto-delete user-owned data to satisfy a generic limit; re-creatable caches may be bounded
more aggressively than user-generated data.

### Guarded writes

Any nontrivial localStorage write can fail when the shared budget is full — handle it. Use
`jd-storage.js` (`JDStorage.setString/setJSON` with optional evict-and-retry; never throws) or
follow the same pattern: catch `QuotaExceededError`, never corrupt the last good value, surface a
clear UI message, don't loop on an impossible write, and evict only when the app has an
intentional eviction policy. Trivial one-line preference writes may use bare localStorage with a
simple try/catch — use judgment, not ceremony.

### Migration safety

When moving existing data (e.g. localStorage → IndexedDB): detect legacy data → write destination
records → commit the transaction → verify (count/read-back) → **only then** remove legacy data →
write a small migration marker → keep it idempotent, tolerant of interruption, and
non-duplicating on reload. **Never delete legacy persistent data before the new copy has been
successfully committed and verified.**

### Orphan cleanup

If a logical record has associated blobs or child records (images, audio, archives, imported
files), deleting the record must delete its children. Replace-all operations must not leave
abandoned records behind. Orphan cleanup is part of storage design, not an afterthought.

### Privacy

Browser storage is convenient, not secure. Minimize retention of sensitive/personal data, avoid
duplication, provide clear deletion, and redact API keys/tokens from any export unless exposing
them is explicitly intended.

### Registering new persistent apps

If a new page persists anything beyond trivial preferences, add an entry to the `APP_HEALTH` map
in `storage-manager.html` (growth/retention/re-creatable/health) — and an `APP_MAP` ownership
entry if it uses new key or database names — so the Storage Manager can classify it. One small
metadata object per app; no registry system.

## General Principles

- Prefer single-file HTML tools with no build step
- Use browser-native APIs before adding dependencies
- Keep data local — no external servers, no tracking
- Design for privacy and offline use where possible
- Use inline styles or a single embedded `<style>` block to keep files self-contained
- Add appropriate `aria-label`, `role`, and semantic HTML for accessibility
- Include a status element for async operations and user feedback

## Quick Checklist for New Pages

- [ ] Create the HTML file
- [ ] Add emoji favicon to `<head>`
- [ ] Add `JUNKDRAWER_DEPLOY_FOOTER` comment and footer with inline styles
- [ ] Add Analytics Lite script for public user-facing pages
- [ ] Storage check (see Browser Storage Architecture): prefs → localStorage; histories/blobs/growing data → IndexedDB with a retention policy; no Base64/data URLs in localStorage
- [ ] For OpenRouter tools, add a provider-grouped model selector populated from OpenRouter after a key is provided
- [ ] If the page persists anything beyond trivial preferences, add `APP_HEALTH` (and `APP_MAP` if new key/DB names) entries in `storage-manager.html`
- [ ] Add entry to `junk-drawer.json` with title, description, emoji, and version
- [ ] Commit with a brief, descriptive message
- [ ] Push to remote
