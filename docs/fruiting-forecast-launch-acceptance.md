# Fruiting Forecast launch acceptance checklist

Allow about 10–15 minutes. Use the production application at <https://hmarquardt.github.io/junkdrawer/fruiting-forecast.html>.

1. Open **About**. Confirm the page reports 922 normalized relevant tiles, dataset `content-db0f839a4352ef82`, and national four-layer coverage. Return to **Forecast**.
2. Search **Salida, Colorado**, choose a 10-mile radius and **Best opportunities**, then run the analysis. Confirm the profile is Southern Rockies, ranked targets appear, and GIS evidence loads.
3. At Salida, choose **Beginner-friendly edibles** and rerun. Confirm the page says no Southern Rockies targets match the active filter, says regional forecast data exists, and never says the region is unsupported or has no model/data. Use the **Best opportunities** recovery button and confirm rankings return.
4. At Salida, choose **Specific species → Morels** and rerun. Confirm it says Morels are not modeled for the Southern Rockies while regional forecast data remains available. Switch back to **All supported edibles** and confirm rankings return.
5. Search **38.3553, -87.5675** with **Best opportunities**. Open a named property that has a Suggested Start. Confirm the start is labeled as an eligible mapped feature with no mapped restriction, while collecting permission and any other restricted access features remain separate.
6. Search **33.5, -112.1**. Confirm Warm Deserts shows **Modeled · sparse**, explains the intentional zero-target model, and does not say Unsupported.
7. Search **49.5, -110.5** with a 10-mile radius. Confirm the GIS message says **No static GIS tiles cover this search area**. Then search **48.9, -110.5** and confirm real U.S. land GIS loads.
8. Repeat the Salida Beginner-friendly case at a narrow mobile width. Confirm the location and Hunt Focus controls, recovery buttons, result message, map, About view, and settings remain reachable with no horizontal scrolling.

Stop and report the exact location, focus, visible message, browser and device if any step differs.
