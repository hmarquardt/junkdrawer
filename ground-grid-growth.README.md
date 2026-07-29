# Ground, Grid and Growth

A local-first civic evidence workbook for evaluating farmland sales, farm economics,
large data-center proposals, utility exposure, public incentives, environmental
conditions, transparency, and enforceable community terms in Southern Indiana.

The app is educational. Its starter numbers and source records are plainly marked
as examples that must be replaced with verified project and research records before
publication.

## Run locally

Open `ground-grid-growth.html` in a current Chrome, Edge, Firefox, or Safari browser.
No installation, build command, server, account, API key, or network connection is
required.

For an HTTP-origin test that more closely resembles GitHub Pages:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/ground-grid-growth.html`.

## Publish on GitHub Pages

Commit the HTML file and this documentation to the repository branch used by GitHub
Pages. The app uses only relative/local content and works from a repository subpath.
No deployment build or environment variables are needed.

## Local data and privacy

- Calculator values remain in the page until changed.
- Named scenarios, source records, claims, comparisons, evaluations, and term sheets
  are stored in IndexedDB for the current browser origin.
- Navigation and the convenience-only Admin passphrase hash use localStorage.
- The app makes no network requests and includes no telemetry.
- Data stored under `file://` and the GitHub Pages URL may be treated as separate
  browser origins. Export a dossier to move records between them.

## Import research data

Open **Source Library**, choose **Import JSON**, and select either:

- an array of source records; or
- an object containing a `sources` array.

The included `ground-grid-growth.sample-sources.json` shows the accepted shape.
Malformed JSON and records missing required source fields are rejected with a plain
language message.

Use **Admin → Import full dataset** for a complete dossier previously exported by
the app. Full imports require the same schema version.

## Add citations

1. Add or import the source in **Source Library**.
2. Enter Admin mode. The local passphrase only prevents casual edits; it is not
   encryption or real access control.
3. Edit a claim and associate source IDs through a complete-dataset export/import.
   The starter UI supports common claim edits; complete relationship editing is
   represented in the data schema.
4. Run **Admin → Check citations**.
5. Verify the title, URL, publication date, limitations, and archived copy before
   marking a source verified in the dataset.

## Save and compare scenarios

Use **Save scenario** in the farm-sale, fiscal, utility, environmental, proposal,
or community-terms section. Give the record a descriptive name. The fiscal section
can show saved scenarios side by side in a comparison table.

## Export reports

- **Print section** prints the active module using the print stylesheet.
- **Grade a Proposal → Print proposal report** prints the proposal evaluation.
- Proposal evaluations and farm scenarios export as JSON.
- Fiscal analyses export as CSV.
- Sources export as JSON or CSV.
- Community conditions export as plain text.
- **Export dossier** packages current inputs and all IndexedDB stores as JSON.

Browsers normally offer “Save as PDF” from the print dialog.

## Files

- `ground-grid-growth.html` — complete application
- `ground-grid-growth.sample-sources.json` — sample research import
- `ground-grid-growth.sample-proposal.json` — sample proposal evaluation
- `ground-grid-growth.schema.md` — data model and migration notes
- `ground-grid-growth.future-enhancements.md` — intentionally deferred work

## Editorial rule

The app keeps private landowner choices, public land-use decisions, measured facts,
project-specific unknowns, advocacy claims, and enforceable protections separate.
A rational private sale is not evidence that a proposed public land use is a good
deal.

