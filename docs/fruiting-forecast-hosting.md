# Fruiting Forecast production data hosting

Infrastructure initially verified 2026-09-17 from `main` at `84b29580e0ffadd4d8f1c6ee1a27a753a817d34b`.
**Data-origin readiness: YES.** Phase 1B integrates remote assets; see the publication section and production reports for current progress.

## Infrastructure

- Cloudflare zone `hanksjunkdrawer.com`: authenticated API reports **active**.
- Authoritative delegation: `fattouche.ns.cloudflare.com`, `magnolia.ns.cloudflare.com`.
- Existing bucket `fruiting-forecast-data`: created 2026-09-17, ENAM, Standard; initially empty.
- Direct custom domain `data.hanksjunkdrawer.com`: enabled, ownership **active**, SSL **active**, minimum TLS 1.2.
- Public `r2.dev` access remains disabled. No Worker, backend, token, or additional bucket created.
- App, manifest, small JSON/config/provenance and app assets remain on the static application host.
- Production Parquet contract: `https://data.hanksjunkdrawer.com/` + relative content-addressed `habitat/`, `pl/`, `fire/`, `ap/` paths. The app and manifest remain on GitHub Pages.
- Phase 1B migrated and verified the pre-existing live objects before setting `manifest.assetBaseUrl`. Batch-1 measurements and final counts are recorded under `data/fruiting-forecast/production/`. Biology remains unchanged.

## Current browser implementation

`GIS_BASE` remains `data/fruiting-forecast/`, so `gisManifest()` and collecting-rule JSON stay on the GitHub Pages application host. Only Parquet paths resolve against optional `manifest.assetBaseUrl`; manifests and fixtures without that field retain the original same-origin behavior. URL joining normalizes the base trailing slash and rejects non-relative asset keys. There is no provider-specific browser logic or credential.

`gisAssetBytes()` performs ordinary GET + `arrayBuffer()`, validates declared length and SHA-256, then supplies the verified local buffer to DuckDB-Wasm 1.30.0. Habitat, public land, fire and access all use this path. A network HEAD or Range request is not required by the production application path.

The IndexedDB key continues to include logical asset ID, dataset version, relative URL and digest, without the host. Cache lifetime remains 30 days and the re-creatable cache remains bounded to 64 records. Therefore verified identical bytes survive the GitHub Pages-to-R2 origin move. Cached bytes are revalidated before use; a failed remote GET can use a previously verified cached copy, while an uncached failure retains missing/unavailable semantics. Collecting-rule JSON keeps its independent seven-day app-host cache.

DuckDB attempts `opfs://fruiting-forecast-gis.duckdb`, with transient DuckDB + IndexedDB bytes as fallback. Production still registers verified local buffers rather than handing DuckDB an unverified remote URL. Direct remote DuckDB SQL was separately proven during infrastructure qualification.

## CORS

Reusable Wrangler policy: [`../config/fruiting-forecast-r2-cors.json`](../config/fruiting-forecast-r2-cors.json).

- Origins: `https://hanksjunkdrawer.com`, `https://www.hanksjunkdrawer.com`, `https://hmarquardt.github.io`, `http://localhost:8000`, `http://127.0.0.1:8000`.
- Methods: GET, HEAD. Allowed request header: Range.
- Exposed response headers: Accept-Ranges, Content-Range. Preflight max age: 3600 seconds.
- GET suffices for the current app. HEAD/Range support permits remote Parquet readers and was explicitly verified. Accept-Ranges is consulted by DuckDB's bundled HTTP code; Content-Range permits JavaScript to inspect partial-response bounds, as verified in the fixture.
- Content-Length and Cache-Control are CORS-safelisted, so no redundant exposure is needed. ETag is returned over HTTP but not exposed: the app validates SHA-256 and does not consume ETag. Direct DuckDB SQL also succeeded without ETag exposure.
- Origins contain no paths: `/junkdrawer/` is not part of the GitHub Pages origin.
- Local development: use `python3 -m http.server 8000`. Other ports and `file://`/null origins are deliberately not allowed; choose the documented port rather than widening to `*`.

Cloudflare's [CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/) describes exact-origin matching and custom-domain behavior. A future policy change may require purging already edge-cached responses; apply policy before publication.

## Measured delivery evidence

The infrastructure canary was `_test/hosting-20260917.parquet`, a synthetic two-row, 373-byte Parquet deleted after verification. Phase 1B subsequently migrated production GIS objects through the separately documented upload/verify/manifest workflow; current counts are in `production/migration.json` and `production/batch1-report.json`.

| Check | Actual result |
| --- | --- |
| TLS | Valid HTTPS without certificate bypass; control-plane SSL active |
| GET | 200, Content-Length 373, full body matches original SHA-256 |
| HEAD | 200, Content-Length 373, no response body |
| Range GET `bytes=0-15` | 206, Content-Length 16, Content-Range `bytes 0-15/373` |
| Accept-Ranges | `bytes` |
| ETag | `"bfbd5a99291d22b92262a71d277426ab"` |
| Cache-Control | `public, max-age=31536000, immutable` |
| Preflight | OPTIONS 204, GET/HEAD and Range allowed |
| CORS | Matching Access-Control-Allow-Origin for all five configured origins |
| Unlisted origin | GET remains public but has no CORS permission; preflight 403 |

SHA-256: `e7434816a152e5b1c337bffc4141f617f9e08daf4c2c49f042f64d90063331a9`.

A temporary Playwright fixture used real Chrome 152 and the GitHub Pages origin (only the fixture HTML was locally fulfilled; CDN and R2 traffic were live). DuckDB-Wasm 1.30.0 successfully executed `SELECT count(*)::INTEGER AS n, sum(id)::INTEGER AS total FROM read_parquet(...)` using both fetched `registerFileBuffer()` and direct `registerFileURL(..., DuckDBDataProtocol.HTTP, ...)`, with both boolean direct-I/O settings. Results: **n=2, total=3**, zero console/page errors. JavaScript HEAD and explicit Range also passed and could read both exposed headers.

The tiny direct-URL query used full GET, not a Range request. This proves direct remote SQL compatibility, not large-file range efficiency. Independent HTTP/browser Range tests prove the origin can satisfy partial reads. No proxy is needed. Temporary fixture, downloaded bytes and verbose evidence stayed under `/tmp`, outside git. An initial Python urllib probe returned 403; curl and actual Chrome requests subsequently passed the complete matrix (no change to Cloudflare security settings).

## Immutable upload contract

For content-addressed Parquet, the publisher sets object metadata at upload:

```sh
npx wrangler r2 object put "fruiting-forecast-data/$ASSET_KEY" --remote \
  --file "$PARQUET_FILE" --content-type application/vnd.apache.parquet \
  --cache-control 'public, max-age=31536000, immutable'
```

It uses relative keys (e.g. `habitat/n30_w084-<digest>.parquet`), verifies full SHA-256/length before publishing manifest references, and never overwrites an immutable key with different bytes. It does not set Content-Encoding merely because Parquet columns are compressed internally. Mutable manifest/config files remain on the application host and do not receive immutable caching.

Measured `CF-Cache-Status: DYNAMIC`: browser cache metadata works, but Cloudflare edge caching of `.parquet` is not proven/enabled by this pass. If edge caching is desired, configure a narrowly scoped cache eligibility rule for the four immutable path prefixes and verify HIT/Range/CORS afterward. This is an optional optimization, not a direct-R2 delivery blocker.

## Domain boundary (Phase 1B)

Application and manifest: `https://hmarquardt.github.io/junkdrawer/`.
Production Parquet: `https://data.hanksjunkdrawer.com/`.
`data.hanksjunkdrawer.com` is the only vanity-domain hostname currently used by Fruiting Forecast.
Apex/www migration is outside this project's scope and is not a launch requirement.
No apex/www DNS or GitHub Pages custom-domain changes were made in Phase 1B.

## Publication and recovery (Phase 1B)

The production manifest now declares `assetBaseUrl`; only Parquet resolves against it.
Legacy fixtures without it retain app-relative resolution. Cache identity is unchanged;
SHA/length are checked on cached bytes, and a failed refresh can use a verified cached copy.
The old tile-level schema-1 URLs shadowed by `tile.habitat` were removed at cutover;
no effective asset URL, digest or bytes changed.

`tools/fruiting_remote.py migrate --report /tmp/migration.json` uploads existing live assets
serially through Wrangler, verifying full public bytes before proceeding. `audit --report
/tmp/audit.json` performs a fresh full GET/hash audit. `hydrate --report /tmp/hydration.json`
restores missing local Parquet from R2 for production-data tests and local GIS tooling.
No GitHub Pages Parquet dependency is required for hydration. Ordinary mocked browser
and publisher unit tests remain independent of R2.

`tools/fruiting_tile_publish.py` inherits the manifest's asset base. Its ordering is
local structural validation → immutable local object → remote upload → full remote
length/SHA verification → atomic manifest update. A kernel-held flock serializes publication
and is released on crash. Valid existing remote objects skip PUT; collisions fail.
The local `.r2-inventory.jsonl` records intent before PUT and verification afterward.
Wrangler 4.133.0 exposes no object-list command; the orphan audit covers that inventory,
not unseen out-of-band writes. Do not claim an exhaustive bucket orphan listing or delete orphans.

Batch-1 scope and evidence live under `data/fruiting-forecast/production/`.
Use `uv run tools/fruiting_batch1.py run --scope data/fruiting-forecast/production/batch1-scope.json
--chunk N` (one shell line) for a serial ten-tile checkpoint, resuming the journal under
`/tmp/ff-batch1-normalized`. Only this frozen Batch-1 scope is authorized by that command.
National/soil cache is `/tmp/ffsrc`; OSM cache is `/tmp/fruiting-forecast-gis-sources`.
New tile DEMs are reclaimed only after Phase-A publication and the journal commit; access
consumes normalized layers and does not depend on the DEM. Reusable national/state sources
and pre-existing DEMs are preserved. Fewer than 8 GiB free stops a chunk before downloads.

## Authentication for future publication

Wrangler 4.133.0's existing OAuth login successfully managed the bucket, domain, CORS and test object. Interactive publication can continue with it; no credentials were opened from configuration files, printed, copied into the repository, or newly created. Zone verification used supported `wrangler auth token --json`, captured privately in process memory and passed as the API Authorization header, never emitted or persisted.

For unattended Batch-1 upload tooling, prefer R2 **Object Read & Write**, scoped only to `fruiting-forecast-data`, using the S3-compatible API. These bucket-scoped credentials are not Cloudflare REST/Wrangler admin tokens. No zone, Worker, or bucket-administration scope is needed. Future environment/secret-store inputs: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL` (the account's R2 S3 endpoint), `AWS_DEFAULT_REGION=auto`. No actual values belong in scripts, HTML, manifests, git or committed `.env` files. See [Cloudflare authentication/scopes](https://developers.cloudflare.com/r2/api/tokens/). The user can authorize/create that scoped credential when unattended publication is implemented; it is not required for the next interactive pass.

## Commands used

All commands below used the observed Wrangler 4.133.0. `$ZONE_ID` is the active zone ID obtained at runtime, deliberately omitted here. Initial sandbox npm/uv cache failures were retried with approved escalation; no cache permissions were changed.

```sh
npx wrangler --version
npx wrangler --help
npx wrangler r2 --help
npx wrangler r2 bucket --help
npx wrangler r2 bucket domain --help
npx wrangler r2 bucket cors --help
npx wrangler r2 bucket domain add --help
npx wrangler r2 bucket domain get --help
npx wrangler r2 bucket cors set --help
npx wrangler r2 object put --help
npx wrangler r2 object delete --help
npx wrangler auth --help
npx wrangler auth token --help
npx wrangler whoami
npx wrangler r2 bucket list
npx wrangler r2 bucket info fruiting-forecast-data
npx wrangler r2 bucket dev-url get fruiting-forecast-data
npx wrangler r2 bucket domain list fruiting-forecast-data
npx wrangler r2 bucket cors list fruiting-forecast-data
# auth token --json was captured privately, never run to a visible terminal.
# Authenticated API GET /zones?name=hanksjunkdrawer.com
# Authenticated API GET /zones/{zone_id}/dns_records?per_page=100 (403)
npx wrangler r2 bucket domain add fruiting-forecast-data \
  --domain data.hanksjunkdrawer.com --zone-id "$ZONE_ID" --min-tls 1.2 --force
npx wrangler r2 bucket cors set fruiting-forecast-data \
  --file config/fruiting-forecast-r2-cors.json --force
npx wrangler r2 object put fruiting-forecast-data/_test/hosting-20260917.parquet \
  --remote --file /tmp/ff-hosting-probe.parquet \
  --content-type application/vnd.apache.parquet \
  --cache-control 'public, max-age=31536000, immutable'
npx wrangler r2 bucket domain get fruiting-forecast-data --domain data.hanksjunkdrawer.com
npx wrangler r2 bucket cors list fruiting-forecast-data
npx wrangler r2 object delete fruiting-forecast-data/_test/hosting-20260917.parquet --remote
```

To reproduce the probe, generate only synthetic data with DuckDB:

```sql
COPY (SELECT 1 AS id, 'R2 hosting probe' AS label
      UNION ALL SELECT 2, 'DuckDB-Wasm')
TO '/tmp/ff-hosting-probe.parquet' (FORMAT PARQUET);
```

After upload, use `curl -D -` with `Origin: https://hanksjunkdrawer.com`, then HEAD (`-I`), Range (`-H 'Range: bytes=0-15'`), and OPTIONS (`-X OPTIONS -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: range'`). Repeat with each configured origin; verify body SHA and delete the probe afterward. Root `/` need not return 200: this is an object origin, not an index website.

## Validation and handoff

Live HTTP/CORS matrix and Chrome/DuckDB checks passed. CORS JSON validation, `git diff --check`, and targeted page convention audit passed. Only this document and the non-secret CORS JSON are changed; no production HTML/Python changed, so biology/browser regression suites and Python compilation were not needed. Existing unrelated worktree changes were preserved and excluded from the commit.

Next pass: implement provider-neutral Parquet asset-base resolution while retaining app-host JSON/manifest resolution, add focused integration/cache regressions, and then undertake the separately authorized national GIS batch workflow. Hosting readiness does not imply national GIS completeness or application launch readiness.
