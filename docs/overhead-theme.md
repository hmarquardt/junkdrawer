# Overhead light/dark theme release

Version: `2026.09.08.1`. This release changes theme presentation only. Layout, density, typography, navigation, scoring, orbital calculations, forecasts, chart geometry, and map gestures are preserved.

## Files changed

- `overhead.html`: semantic color tokens, light palette, Settings appearance buttons, guarded preference, SVG colors, and map paint updates.
- `junk-drawer.json`: synchronized page version.
- `tests/overhead.spec.js`: theme, contrast, responsive, persistence, dark-baseline and map-state regression coverage.
- `docs/overhead-theme.md`: this report.

The calculation engine, worker, dependencies, storage registry and original product architecture are unchanged. The existing `overhead.` storage ownership prefix already covers the new preference.

## Theme architecture and preference

The original palette remains the default `:root` palette. `[data-theme="light"]` overrides centralized semantic colors for surfaces, text, borders, actions, scores, warnings, chart grids, twilight, clouds and map paint. The original `--lime`, `--blue` and other short names remain compatible with existing selectors; semantic aliases are available for future styling.

Light mode uses warm off-white, near-white sky surfaces, charcoal text, deep green opportunity scores, blue links and accents, and brown/amber warnings. Existing labels and numbers convey meaning alongside color. SVG presentation attributes reference the same CSS variables, including chart text, rings, arrows, paths and cloud opacity. Switching themes does not rerender components or recalculate events.

Settings contains compact Light and Dark buttons in an Appearance group. Both have meaningful accessible names, `aria-pressed`, keyboard activation, visible focus, and a 44px minimum height. The control applies immediately without submitting other settings.

The explicit choice is stored as `light` or `dark` in `localStorage['overhead.theme']`. A small head script reads it before the first paint and synchronizes the browser theme-color metadata. First visits preserve the original dark default, regardless of system color scheme. Once selected, the choice persists through reload and is unaffected by system theme changes. Storage failure leaves the chosen theme active for the session and reports that saving failed; it does not interrupt the app.

## Map behavior

MapLibre, the OSM raster source, ground-track layer, marker locations, and gestures remain the same. Theme changes call `setPaintProperty` for background, raster saturation/brightness and track color. Marker SVG fills use CSS variables. No `setStyle`, map reconstruction, fitting, centering, source replacement, or pass recalculation occurs during theme switching.

The light map uses a brighter, gently desaturated basemap with deep blue and green markers. The dark map retains its original saturation and brightness. The legend uses “Green” for both the original lime and the darker daytime variant. App map buttons and light attribution surfaces follow the palette. Raster labels remain part of the third-party basemap, not CSS text whose contrast the app can individually guarantee.

## Contrast and accessibility audit

Ratios were calculated from the rendered light-theme token values, including compositing translucent cloud bands over each twilight background. Normal text targets 4.5:1; meaningful chart graphics and control boundaries target 3:1.

| Treatment | Lowest tested contrast |
| --- | ---: |
| Primary text across page, panel, status and hover surfaces | 11.52:1 |
| Secondary text / status / diagnostic text | 5.37:1 |
| Green opportunity scores | 5.97:1 |
| Blue links and informational accents | 6.07:1 |
| Amber warning / possible-state token | 5.50:1 |
| Danger token | 5.90:1 |
| White text on selected controls | 7.13:1 |
| Sky elevation and horizon rings | 3.48:1 |
| Input boundaries | 3.86:1 |
| Cloud overlays across twilight/night bands | 3.60:1 |
| Satellite timeline markers | 5.59:1 |

Disabled controls in light mode use solid readable text rather than inherited low opacity. Placeholder text is explicit and readable. Native inputs/selects and unstyled scrollbars receive `color-scheme: light`. Browser-native SVG-title tooltips remain browser-managed; no new custom tooltip component is introduced. Decorative separators and faint guide lines are not treated as text or essential data markers.

Inspected page/header, navigation, event and seven-night cards, scores, details, sky chart and compass, timeline/cloud/twilight/Moon layers, forecast rows, maps, settings, location inputs, saved sites, favorites, diagnostics, links, hover/focus/selected states, and empty/error/storage-failure surfaces. Stale/provisional/loading messages retain their existing text-based meanings and share the audited status/text palette.

## Responsive and regression results

Chrome tests cover 390, 768, 1024, 1440 and 1920px in both themes. Main-screen component rectangles are identical before/after switching; there is no horizontal overflow. The same map instance, camera, selected pass, source object and result object survive both theme transitions at each width. Map screenshots wait for the existing paint transitions to settle.

The dark Tonight screen is compared pixel-for-pixel with the previously deployed `8725153` version at all five widths: zero differing pixels. Only the release footer and asynchronous freshness text are masked; request completion order can change the freshness-line ordering. This comparison concerns the existing dashboard; Settings necessarily gains the requested appearance control.

Regression coverage also checks keyboard focus/activation, pressed state, initial dark behavior under a light system preference, explicit light choice surviving a system change and reload, the saved theme being present at the first animation frame, and quota failure without losing session functionality. Existing source-failure/cache, location, favorites, and seven-night tests remain included.

Final result: all five Chrome tests passed (14.3 seconds). The compliance audit reported zero errors and zero warnings.

Run:

```sh
npx playwright test tests/overhead.spec.js --reporter=line --workers=1
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh overhead.html
```

The theme integration test uses a local test-only HTTP server for worker and baseline comparisons, fixed source fixtures, and the existing MapLibre/OSM network dependencies for map checks. The shipped app still needs no backend or build step. Screenshots are written to `/private/tmp`, not the repository. Physical devices and all browser/OS combinations were not tested.

The frontend-design skill guided the light palette without changing product hierarchy. Junkdrawer testing, versioning and compliance skills guided regression checks and synchronized release metadata.
