# Hank's Junk Drawer

A GitHub Pages collection of standalone, single-file browser apps and experiments.

Most pages in this repo are intentionally self-contained: one `.html` file with inline HTML, CSS, and JavaScript. There is no build step and no backend for the base apps. The homepage discovers pages in the repository and uses `junk-drawer.json` to show nicer titles, descriptions, emoji, and hidden/private entries.

## Current Apps

| App | File | Purpose |
|---|---|---|
| RWS Time Block Timer | `rwstime.html` | Countdown helper for timesheet blocks. |
| Collection of Absurdities | `collectionofabsurdities.html` | A collection of odd stories and absurd links. |
| Bookmarklet Collection | `bookmarklets.html` | Local bookmarklet shelf with drag-to-bookmarks links and highlighted source. |
| Signal Drawer | `signal-drawer.html` | Local RSS/topic tracker with configurable feeds, key terms, source diagnostics, and cached results. |
| Pontifex Daily Desk | `pontifex-daily-desk.html` | Educational Solitaire/Pontifex cipher notebook with daily public seed keying. |
| Manual Party Line | `manual-party-line.html` | One-to-one WebRTC video/audio chat using manual copy/paste signaling. |
| Crypto Mood Ring | `crypto-mood-ring.html` | Local-first crypto dashboard with market data, RSS news, IndexedDB retention, and optional OpenAI commentary. |
| Waypoint Route Builder | `waypoint-route-builder.html` | Build ordered map routes from latitude/longitude pairs with Google Maps exports. |

`private-test.html` is intentionally hidden by metadata.

## How The Homepage Works

`index.html` is the landing page. It uses the public GitHub repository API to inspect the repo contents and discover `.html` files. Because GitHub Pages is static hosting, browser JavaScript cannot simply list files from the server directory, so the GitHub API is used instead.

The homepage then reads `junk-drawer.json` for display metadata:

```json
{
  "pages": {
    "crypto-mood-ring.html": {
      "title": "Crypto Mood Ring",
      "description": "Local-first crypto dashboard for market ticks, RSS news, and optional LLM vibes.",
      "emoji": "₿"
    },
    "private-test.html": {
      "hide": true
    }
  }
}
```

Supported metadata fields:

| Field | Purpose |
|---|---|
| `title` | Display name for the page card. |
| `description` | Short explanation shown under the title. |
| `emoji` | Visual marker for the card. |
| `hide` | If `true`, the page is not shown on the homepage. |

If a page has no metadata, the homepage falls back to a readable title generated from the file name.

## Project Direction

This started as a simple GitHub Pages index for random standalone HTML pages. Over time it has become a small local-first app shelf:

- The homepage now auto-discovers pages and uses `junk-drawer.json` for clean cards.
- Favicons and web app manifest assets were added.
- Several tools now use `localStorage` or IndexedDB for local-only persistence.
- RSS apps include proxy settings because browser RSS fetches often fail due to CORS.
- Crypto Mood Ring added optional OpenAI analysis, Coinbase/Kraken WebSocket options, REST fallback, dashboard help, and safer LLM JSON parsing.
- Manual Party Line added a backend-free WebRTC proof of concept with copy/paste signaling.
- Pontifex Daily Desk added an educational cipher notebook with daily public seed support.

## App Notes

### Signal Drawer

Signal Drawer is a personal RSS/topic tracker. It stores sources, key terms, article cache, hidden/saved state, settings, and diagnostics in browser storage. It supports RSS proxy configuration because many feeds do not allow direct browser fetches.

### Crypto Mood Ring

Crypto Mood Ring is a research dashboard, not a trading tool. It does not place trades, connect to wallets, or connect to exchange accounts.

It uses:

- Dexie/IndexedDB for coins, price ticks, snapshots, news articles, logs, and LLM analysis history.
- `localStorage` for settings and an optional remembered OpenAI API key.
- CoinGecko REST polling as the reliable default market data path.
- Optional Coinbase, Kraken, or Binance WebSocket feeds for live market data.
- RSS feeds plus a configurable proxy for crypto news.
- Optional OpenAI Responses API calls for educational “market vibes,” clearly labeled as not financial advice.

### Manual Party Line

Manual Party Line is a v1 WebRTC demo. It has no signaling server. Offer/answer JSON must be manually copied between users. Public STUN servers are included, but restrictive networks may require TURN.

### Pontifex Daily Desk

Pontifex Daily Desk implements Bruce Schneier’s Solitaire/Pontifex cipher for education. It clearly warns that this is not modern secure encryption. It can derive a reproducible daily public seed from NASA APOD and optionally combine it with a private phrase.

## Adding A New Page

1. Add a standalone `.html` file to the repository root.
2. Commit and push it.
3. Add an entry to `junk-drawer.json` if you want a custom title, description, or emoji.
4. GitHub Pages will serve it after deployment.

Example metadata:

```json
{
  "pages": {
    "new-tool.html": {
      "title": "New Tool",
      "description": "Short description of what it does.",
      "emoji": "🧰"
    }
  }
}
```

## Local-First Storage

Several apps store data only in the browser:

- `localStorage` is used for lightweight settings and preferences.
- IndexedDB is used where larger or structured data is needed.
- Clearing browser site data will remove locally stored app data.
- `localStorage` is not secure storage. Do not store sensitive secrets on shared machines.

## Network And CORS Limitations

These apps run from static hosting, so there is no private backend by default.

Important limitations:

- RSS feeds may fail because many sites block browser cross-origin requests.
- Proxy settings are included in RSS-heavy apps, but public proxies can be slow or unreliable.
- WebSocket market feeds can fail because of region, network, VPN, firewall, or browser policy.
- OpenAI API keys used in the browser are visible to that browser session and should be treated carefully.

## GitHub Pages

This repo is intended to be deployed directly through GitHub Pages from `main`.

Typical URL format:

```text
https://hmarquardt.github.io/junkdrawer/
```

Because this is a repo-based Pages site, app links and assets should use relative paths where possible.

## Development Style

The default pattern is:

- Single-file app.
- Inline CSS and JavaScript.
- No build system.
- No backend unless a future app explicitly introduces one.
- Vanilla JavaScript unless a CDN library is clearly useful.
- Local-first data storage where practical.

External CDN libraries currently used where useful include Dexie and Chart.js in Crypto Mood Ring.

## Favicons And PWA Assets

The repo includes favicon and manifest assets:

```text
favicon.ico
favicon.svg
favicon-96x96.png
apple-touch-icon.png
site.webmanifest
web-app-manifest-192x192.png
web-app-manifest-512x512.png
```

Standalone pages can reference these with relative paths.

## Limitations

- The homepage works best when the repository is public because it uses the GitHub public contents API.
- GitHub API responses may be cached briefly.
- Browser storage is per-browser and per-device.
- Static apps cannot hide API keys from the user’s browser.
- Public proxies and public market APIs can rate-limit, time out, or change behavior.
