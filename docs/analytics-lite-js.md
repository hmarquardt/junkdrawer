# Analytics Lite JS

`analytics-lite.js` is a dependency-free browser tracking helper for Junk Drawer / JunkStats pages. It sends one pageview event after the page finishes loading, stores an anonymous visitor ID in `localStorage`, stores a tab-scoped session ID in `sessionStorage`, and posts the payload to the Analytics Lite backend.

Backend collection endpoint:

```text
https://lab.aismallbizguru.com/api/analytics/collect
```

No browser token is needed or wanted. Do not put secrets in pages that use this library.

## Include It

Add the script to a standalone page:

```html
<script
  src="analytics-lite.js"
  data-site-id="junkdrawer"
  data-api="https://lab.aismallbizguru.com/api/analytics/collect"
  defer>
</script>
```

You can also configure it before loading the script:

```html
<script>
window.JunkStatsConfig = {
  siteId: "junkdrawer",
  endpoint: "https://lab.aismallbizguru.com/api/analytics/collect",
  respectDoNotTrack: true,
  heartbeatSeconds: 0,
  debug: false
};
</script>
<script src="analytics-lite.js" defer></script>
```

Global `window.JunkStatsConfig` values take precedence over script data attributes, and script data attributes take precedence over defaults.

## Config Options

| Option | Default | Purpose |
|---|---:|---|
| `siteId` | `junkdrawer` | Site identifier sent as `site_id`. |
| `endpoint` | `https://lab.aismallbizguru.com/api/analytics/collect` | Collection endpoint. |
| `respectDoNotTrack` | `true` | Disables tracking when browser Do Not Track is enabled. |
| `heartbeatSeconds` | `0` | Sends one delayed `heartbeat` event when greater than zero. |
| `debug` | `false` | Logs useful messages prefixed with `[JunkStats]`. |

Script attributes use `data-site-id`, `data-api` or `data-endpoint`, `data-respect-do-not-track`, `data-heartbeat-seconds`, and `data-debug`.

## Debug Example

```html
<script>
window.JunkStatsConfig = {
  siteId: "junkdrawer",
  endpoint: "https://lab.aismallbizguru.com/api/analytics/collect",
  debug: true
};
</script>
<script src="analytics-lite.js" defer></script>
```

## Public API

After the script loads, `window.JunkStats` exposes:

```js
window.JunkStats.trackPageview();
window.JunkStats.trackEvent("example_event", { source: "demo" });
window.JunkStats.getVisitorId();
window.JunkStats.getSessionId();
window.JunkStats.config;
```

The automatic pageview is sent once per page load. Manual calls are available for future instrumentation.

## Junk Drawer Coverage

Most public user-facing Junk Drawer pages include `analytics-lite.js`. `analytics-dashboard.html` is intentionally excluded so dashboard refreshes do not pollute analytics, and hidden/private/test pages are not tracked by default.

## Privacy Notes

The library does not use cookies, collect form fields, read localStorage except for `junkstats.visitor_id`, collect exact GPS, or require a token. It captures page URL/path/title, referrer URL/domain, UTM parameters, browser language, timezone, screen and viewport dimensions, user agent, and basic navigation timing when available.

If the backend is unavailable, errors are swallowed unless `debug` is enabled.
