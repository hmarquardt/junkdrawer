# Ground, Grid and Growth data schema

Current schema version: **1**

Every stored record has:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable record identifier |
| `schemaVersion` | integer | Record migration version |
| `updatedAt` | ISO datetime | Last local write |

The complete dossier adds `appVersion`, `schemaVersion`, `exportedAt`, `settings`,
current unsaved calculator inputs, and a `stores` object.

## IndexedDB stores

| Store | Core record fields |
|---|---|
| `sources` | title, organization, author, URL, dates, geography, sourceType, topicTags, summary, keyFindings, limitations, perspective, primarySecondary, archivedCopy, notes, verified |
| `claims` | claimText, topic, rating, explanation, truth, exaggerated, unknown, questions, sourceIds, qualifyingSources, geography, publicationYear, confidence, notes, verified |
| `farmScenarios` | name, values for land, rent, debt, heirs, offer, growth, and holding period |
| `dataCenterProjects` | name, project type, site, phase, load, cooling, jobs, generator, and source relationships |
| `landUseComparisons` | group, metric, land-use/value map, sourceIds, notes, verified |
| `fiscalScenarios` | name and values for investment, tax base, exemptions, abatement, contributions, costs, bond, and completion |
| `utilityScenarios` | name and values for MW, load factor, minimum bill, term, infrastructure, contributions, collateral, cancellation, and buildout |
| `environmentalScenarios` | name, topic (`water`, `noise`, or `light`), and topic-specific values |
| `proposalEvaluations` | projectName, jurisdiction, category array, provisional results, missing documents, and recommended conditions |
| `communityTermSheets` | jurisdiction, projectName, and selected/customized terms |
| `imports` | import kind, file name, record count, and timestamp |

## Application settings

Lightweight settings use localStorage:

- `ggg:section` — last active section
- `ggg:adminHash` — one-way hash used only for the convenience Admin lock

The Admin lock is not authentication or encryption.

## Controlled values

Claim ratings:

1. Well established
2. Generally true, but project-dependent
3. Possible but unproven
4. Misleading without context
5. Not supported by available evidence

Source types:

- Government data
- Academic or university research
- Utility or regulatory filing
- Industry source
- Advocacy source
- Local reporting
- Developer statement
- Legal or planning document

Comparison values may be numeric, a range, low, medium, high, unknown, or not
applicable. Importers must not turn a missing value into zero.

## Validation rules

- Imported JSON must parse without code execution.
- Source imports must be an array or an object with a `sources` array.
- Each source requires a string `title`, string `organization`, and recognized
  `sourceType`.
- Complete dossiers require `schemaVersion: 1` and a `stores` object.
- Unknown store names are ignored.
- Records without IDs are rejected from full-dossier imports.
- Calculators coerce malformed numeric input to a safe finite fallback and guard
  division by zero.

## Citation relationships

Claims and comparison rows link to sources by stable `sourceIds`. Project and
scenario records may use the same relationship. A source can be advocacy,
industry, developer, or government material; its type and limitations determine
how it should be used, not whether it is hidden.

## Migration approach

Future releases should:

1. Increment the IndexedDB database version when store structure changes.
2. Preserve record IDs.
3. Migrate records based on each record’s `schemaVersion`.
4. Retain unknown fields where practical for forward compatibility.
5. Require an explicit export before a destructive or lossy migration.
6. Increment the dossier schema only when import compatibility changes.

