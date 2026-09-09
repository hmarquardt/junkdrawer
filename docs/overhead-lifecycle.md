# Overhead lifecycle hardening — 2026.09.08.9

**Follow-up, .10:** subsequent field observation and a full live-source UI trace reproduced the missing presentation mechanism: score-zero ISS ranked 136th, excluded by the six-row limit. See [the presentation repair and exact weather audit](overhead-awareness.md). The original .9 investigation below is preserved as history; no malformed timing was needed to reproduce the UI failure.

## Field report: what is and is not reproduced

**The exact reason the field user's 8:17 PM event disappeared at about 8:00 PM is not established.** No original browser timing snapshot, selected settings, observer state or clock reading was supplied. This release fixes demonstrable lifecycle weaknesses; it does not claim proof of the field incident's cause.

Before changing application code, `node tests/overhead-lifecycle.cjs --before` was run against release .8. The archived real ISS OMM epoch September 7, 11:57:47 UTC, propagated for Princeton (38.3553, −87.5675), produces these September 8 America/Chicago times:

| Field | Local time | UTC, September 9 |
| --- | --- | --- |
| now | 8:00:00 PM | 01:00:00.000Z |
| rise | 8:14:57 PM | 01:14:57.235Z |
| start | 8:17:02 PM | 01:17:02.485Z |
| peak.t | 8:20:22 PM | 01:20:22.265Z |
| end | 8:22:34 PM | 01:22:33.985Z |
| set | 8:25:49 PM | 01:25:48.563Z |
| orbitalPeak.t | 8:20:22 PM | 01:20:22.304Z |

Both original filters retained this event at 8:00 PM. Start and peak are mathematically contained in the engine's selected interval; the distinction between visible end and geometric set alone cannot explain a 17-minute-early disappearance. An ordinary 8:17–8:23 fixture likewise passes the old checks.

An explicitly **synthetic malformed** fixture with start 8:17, peak 8:20, but end **7:59** reproduces disappearance from both old filters at 8:00. They trusted `end` without checking the future start/peak. This establishes the missing invariant protection, not the historical presence of malformed data. The old code also demonstrably removed every ended event immediately, with no feed retention.

Potential original-state explanations (inconsistent times, device clock, selected date/site, source refresh or score filters) remain hypotheses, not findings. Obtain the new timing diagnostics plus observer/timezone/settings and source status if the field issue recurs. Do not attribute it to SGP4 or change visibility geometry without evidence.

## Shared model

`overhead-lifecycle.js` exports the pure `eventLifecycle(pass, now)`; all times are epoch milliseconds. It never mutates a pass or recalculates geometry/quality.

- `viewingStart = start` (finite-timestamp fallback for malformed data).
- `viewingEnd = max(start, end, peak.t)` over finite values. The extra start guard prevents malformed ordering from expiring a displayed future start.
- `geometricSet = set`, independently exposed; it does **not** extend recommendation eligibility.
- `displayUntil = max(viewingEnd, rise, set, orbitalPeak.t) + 10 minutes`. Geometric fields protect detail timestamps, not a claim that a shadowed satellite remains visible.
- Upcoming: before viewingStart, with viewing time remaining. In progress: from viewingStart up to, but excluding, viewingEnd.
- Recently ended: viewingEnd reached, but displayUntil not reached. Expired: displayUntil reached.
- Recommendation eligibility ends exactly at viewingEnd; feed retention ends exactly at displayUntil.
- Missing all timing values stays inspectable with a warning, never an actionable recommendation.

Checks: rise ≤ set; start ≤ end; start ≤ peak ≤ end; rise ≤ orbitalPeak ≤ set. One-second numerical tolerance applies only to warnings, not expiry. Finite timestamps are checked. The raw values are preserved and exposed with corrected lifecycle boundaries; no geometry is silently rewritten.

Tonight and weekly ranking now use the same lifecycle definition. Weekly quality, significance, prominence, classification and tie logic are byte-for-byte unchanged apart from the eligibility predicate. The Tonight briefing/night score considers actionable passes only. Feed rows use IN PROGRESS / JUST ENDED, or TIMING WARNING for inconsistent fields. Retained rows still open the original detail dialog. Existing selection protection preserves the selected pass during its retention period, and an open dialog is not rewritten or closed by minute renders—even after feed expiry.

Diagnostics include selected and weekly-best lifecycle, raw timestamps, now, viewingStart/viewingEnd, geometricSet, displayUntil, milliseconds to start/end, invariant validity and warnings. All loaded results are scanned for violations; at most 50 warning records are rendered, with total count disclosed. No diagnostic history or new storage is introduced.

## Deterministic validation

Fixture: September 8, 2026, America/Chicago; start 20:17, peak 20:20, end 20:23, set 20:25. Tests use absolute September 9 UTC timestamps, not machine timezone.

| Local time | State | Weekly eligible | Feed/details retained |
| --- | --- | --- | --- |
| 20:00, 20:16 | upcoming | yes | yes |
| 20:17, 20:18, 20:21 | in-progress | yes | yes |
| 20:23, 20:24, 20:25, 20:34:59.999 | recently-ended | no | yes |
| 20:35 | expired | no | no normal feed row; already-open dialog remains |

The named browser regression **“ISS 8:17 PM pass must not disappear at 8:00 PM”** performs minute-by-minute renders from 20:00–20:34, checks the weekly winner switches to a future event at 20:23, preserves the selected ID and dialog markup, reopens recently ended directions/sky path, and checks removal at 20:35. The malformed fixture remains in feed and ranking with an invariant warning. The original results object remains identical: no propagation or score updates caused by rendering.

Existing suites remain in scope: 16 weekly scenarios and the unchanged 576-case score distribution; 20 Train Watch/public-freshness scenarios; 116 orbital passes across four sites with four archived external ISS comparisons; metadata, source/cache failures, saved sites, favorites, maps, both themes and 390/768/1024/1440/1920 px browser checks. No scientific revalidation is claimed beyond those unchanged regressions.

Final run: **14/14 Chrome browser tests passed**, including the missing-metadata-module fallback; all listed Node suites passed, including 14 object-metadata scenarios. Junkdrawer compliance audit: zero errors and zero warnings. No horizontal overflow or theme-switch state loss was detected at the five widths. The existing light-theme contrast assertions passed; this release changes no palette tokens.

## Live-source browser smoke

Run: `OVERHEAD_LIVE=1 npx playwright test tests/overhead-lifecycle-live.spec.js --reporter=line --workers=1` (opt-in; never part of offline deterministic tests).

On September 9 at 01:11:36 UTC (September 8 local), the real app fetched live CelesTrak/Open-Meteo sources. ISS epoch: September 8 11:11:17.177 UTC. Upcoming Princeton pass: rise 01:14:56.532Z, start 01:17:01.782Z, peak 01:20:21.316Z, visible end 01:22:32.782Z, set 01:25:47.391Z; orbital peak 01:20:21.269Z.

**Passed 40 minute renders with a fixed-time simulation around that real pass.** Feed retention, weekly eligibility, IN PROGRESS, JUST ENDED, unchanged dialog/sky chart and result-object identity all passed, with no page exceptions. This is a live-source browser test, not an outdoor observation or a real-time 40-minute wait. Its live-weather sighting score was 0; the test verified lifecycle eligibility without artificially improving weather or quality. It does not verify the field user's earlier high score or original browser state.

## Scope

Files: `overhead-lifecycle.js` (new shared helper), `overhead-weekly.js` (eligibility only), `overhead.html` (feed, diagnostics, script, version), `junk-drawer.json`, this document and `docs/overhead.md`; regression files `tests/overhead-lifecycle.cjs`, `tests/overhead-lifecycle-live.spec.js`, `tests/overhead.spec.js`, and the metadata test server's static-file allowlist in `tests/overhead-objects.spec.js`.

No SGP4, visibility, illumination, score weights, exceptional thresholds, weather, Train Watch, object metadata, theme, map, source or cache behavior changed. Junkdrawer testing/versioning conventions govern QA and synchronized release metadata.
