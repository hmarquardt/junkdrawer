---
name: junkdrawer-page-testing
description: Test Junkdrawer single-file HTML apps locally with Playwright. Use when verifying page behavior, debugging UI issues, capturing screenshots or console errors, or writing specs under tests/ — covers the repo's established pattern of Node @playwright/test with file:// URLs, the real Chrome channel, and pageerror/console capture.
---

# Page Testing

These are static single-file apps, so no dev server is needed: load them via `file://` URLs. The repo's proven pattern lives in `tests/ground-grid-growth.spec.js` — follow it.

## Quick smoke check (one-off script)

```js
// /tmp/smoke.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.new_page?.() ?? await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file:///Users/hmarquardt/junkdrawer/<page>.html', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');   // let CDN/deferred scripts settle
  await page.screenshot({ path: '/tmp/page.png', fullPage: true });
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console/page errors');
  await browser.close();
})();
```

Run with `node /tmp/smoke.js` from a directory where `playwright` is resolvable (or `npm exec -- playwright ...`). If Chrome channel is unavailable, drop `{ channel: 'chrome' }` to use bundled Chromium.

## Repo conventions for specs

- Specs live in `tests/<page>.spec.js` and use `require('@playwright/test')` (CommonJS).
- Build the URL as `` `file://${path.resolve(process.cwd(), '<page>.html')}` `` so specs run from the repo root.
- `test.use({ channel: 'chrome' })` — matches what the user actually runs.
- Always attach `pageerror` and console-`error` listeners and assert the collection is empty at the end.
- Prefer `window.__<APP>_TEST__`-style hooks (e.g. `window.__GGG_TEST__`) exposed by the page for deterministic state assertions; add such a hook when making a page testable.
- Screenshots go to `/tmp/` or `test-results/`, never into the repo.
- Run with: `npx playwright test tests/<page>.spec.js` (no config file exists; pass flags explicitly, e.g. `--reporter=line`).

## Interaction tips

- After navigation, `await page.waitForLoadState('networkidle')` before inspecting dynamically rendered DOM.
- Prefer `role=`, `text=`, and ID selectors; these pages use semantic HTML and IDs heavily.
- IndexedDB/localStorage persist between page loads in the same context — use a fresh context per test to avoid state bleed.
- Pages that call external APIs (OpenRouter, market feeds, RSS proxies) should be tested with requests blocked/mocked: `page.route('**openrouter.ai**', r => r.abort())`, and analytics calls can be aborted the same way (`**/api/analytics/**`).

## After fixing anything a test revealed

Bump the page version (`junkdrawer-version-bump`) and re-run the compliance audit before committing.
