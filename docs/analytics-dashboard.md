# JunkStats Dashboard

`analytics-dashboard.html` is a standalone Junk Drawer page for viewing Analytics Lite / JunkStats traffic. It is intentionally static: no build step, no bundled secrets, and no local backend.

The production backend lives at:

```text
https://lab.aismallbizguru.com/api
```

Dashboard data comes from:

- `/analytics/summary`
- `/analytics/timeseries`
- `/analytics/pages`
- `/analytics/referrers`
- `/analytics/recent`

## Token

The dashboard endpoints require:

```text
Authorization: Bearer <ANALYTICS_DASHBOARD_TOKEN>
```

The token lives on the VPS. It must never be committed to this repository, pasted into docs, or added to page source.

The dashboard stores the token in memory by default. It only writes the token to `localStorage` when “Remember token in this browser” is checked.

## How To Use

1. Open `analytics-dashboard.html` locally or from GitHub Pages.
2. Use API base `https://lab.aismallbizguru.com/api`.
3. Use site ID `junkdrawer`.
4. Enter the dashboard token from the VPS.
5. Choose a date range.
6. Click Load or Refresh.

## Date Ranges

The dashboard supports Today, Yesterday, Last 7 days, Last 30 days, and Custom. Today and Yesterday request hourly timeseries buckets. Longer ranges request daily buckets.

All analytics requests include `site_id`, `from`, and `to` query parameters. List endpoints also request reasonable limits.

## Privacy

This dashboard displays anonymous pageview analytics. The tracking library does not use cookies or collect form fields. The dashboard itself does not include `analytics-lite.js`, so dashboard refreshes do not pollute analytics by default.

## Troubleshooting

### 401 token issue

“Token rejected or missing” means the token is absent, expired, mistyped, or not the dashboard token expected by the backend. Get the current token from the VPS and try again.

### CORS or backend unavailable

“Could not reach analytics backend” usually means the API is down, unreachable from the browser, blocked by CORS, or the API base URL is wrong.

### Empty results

Empty tables or cards can be normal for quiet date ranges. Try Last 30 days, verify `site_id` is `junkdrawer`, and confirm `analytics-lite.js` is installed on the page you expect to track.

### Token not saved

The token is only saved when “Remember token in this browser” is checked. Clearing the checkbox or using Clear removes `junkstats.dashboard.token` from `localStorage`.
