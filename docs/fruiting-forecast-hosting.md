# Fruiting Forecast production data hosting

Verified 2026-09-17 from `main` at `84b29580e0ffadd4d8f1c6ee1a27a753a817d34b`.
**Data-origin readiness: YES.** Application integration and GIS production are separate subsequent work.

## Infrastructure

- Cloudflare zone `hanksjunkdrawer.com`: authenticated API reports **active**.
- Authoritative delegation: `fattouche.ns.cloudflare.com`, `magnolia.ns.cloudflare.com`.
- Existing bucket `fruiting-forecast-data`: created 2026-09-17, ENAM, Standard; initially empty.
- Direct custom domain `data.hanksjunkdrawer.com`: enabled, ownership **active**, SSL **active**, minimum TLS 1.2.
- Public `r2.dev` access remains disabled. No Worker, backend, token, or additional bucket created.
- App, manifest, small JSON/config/provenance and app assets remain on the static application host.
- Future Parquet contract: `https://data.hanksjunkdrawer.com/` + existing relative content-addressed `habitat/`, `pl/`, `fire/`, `ap/` paths. No manifest or application edits in this pass.
- No national planner, GIS production, state preparation, DEM download, or existing dataset migration was run. Biology is unchanged.

## Current browser implementation

In `fruiting-forecast.html`, `GIS_BASE` is still `data/fruiting-forecast/`.
`gisManifest()` fetches its manifest there and caches it in IndexedDB for one hour.
`gisAssetBytes()` uses ordinary GET + `arrayBuffer()`, validates declared length and SHA-256 when WebCrypto is available, then calls `registerFileBuffer()` for DuckDB-Wasm 1.30.0 queries. Habitat, public land, fire and access all use this path. No network HEAD or Range is required by this application path.

Its IndexedDB key includes logical asset ID, dataset version, relative URL and digest; it is **not digest-only**, and does not currently include the host/base URL. Cache lifetime is 30 days, with the shared re-creatable cache bounded to 64 records. A base-origin change can reuse identical cached content if the relative path/version/digest remain stable. Legacy `gisTileBytes()` keys use tile ID + digest/size, validate length but not SHA; the current habitat path uses `gisAssetBytes()` instead. Collecting-rule JSON has a separate seven-day cache and must stay on the app host.

DuckDB attempts `opfs://fruiting-forecast-gis.duckdb`, with transient DuckDB + IndexedDB bytes as fallback. Coverage processing still walks selected tiles and obtains their bytes; opening OPFS is not proof of verified offline table reuse. No remote URL registration exists in production code. Keep these semantics intact during the later asset-base integration.

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

Only `_test/hosting-20260917.parquet` was uploaded: a synthetic two-row, 373-byte Parquet, then deleted after verification. No GIS bytes were uploaded.

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

For future content-addressed Parquet, set object metadata at upload:

```sh
npx wrangler r2 object put "fruiting-forecast-data/$ASSET_KEY" --remote \
  --file "$PARQUET_FILE" --content-type application/vnd.apache.parquet \
  --cache-control 'public, max-age=31536000, immutable'
```

Use relative keys already present in the manifest (e.g. `habitat/n30_w084-<digest>.parquet`), verify full SHA-256/length before publishing manifest references, and never overwrite an immutable key with different bytes. Do not set Content-Encoding unless the whole object actually uses that transport encoding. Parquet's internal compression is not HTTP Content-Encoding. Mutable manifest/config files remain on the application host and must not get immutable caching.

Measured `CF-Cache-Status: DYNAMIC`: browser cache metadata works, but Cloudflare edge caching of `.parquet` is not proven/enabled by this pass. If edge caching is desired, configure a narrowly scoped cache eligibility rule for the four immutable path prefixes and verify HIT/Range/CORS afterward. This is an optional optimization, not a direct-R2 delivery blocker.

## DNS and manual application-domain work

| Host | Observed state |
| --- | --- |
| `hanksjunkdrawer.com` | Proxied Cloudflare A responses `104.21.60.225`, `172.67.201.245`; HTTPS 522 |
| `www.hanksjunkdrawer.com` | Same public proxy addresses; HTTPS 525 |
| `data.hanksjunkdrawer.com` | Same proxy addresses; working R2 custom domain and HTTPS |

The OAuth session has zone-read but no ordinary DNS read/write permission: `/zones/{zone_id}/dns_records?per_page=100` returned 403/code 10000. Thus underlying apex/www records are hidden behind Cloudflare proxying; **continued Namecheap parking cannot be confirmed or excluded**. No ordinary DNS records were changed. R2 managed its own custom-domain attachment.

GitHub Pages at `https://hmarquardt.github.io/junkdrawer/` returns 200. No local CNAME or Pages workflow is present; deployed `/junkdrawer/CNAME` returns 404. `gh api repos/hmarquardt/junkdrawer/pages` cannot authenticate (gh has no login), and unauthenticated REST returns 404. Actual Pages settings/custom-domain ownership remain unverified; this is why the app domain was not changed automatically.

Manual app-domain migration, independent of the ready R2 origin:

1. Inspect repository Settings → Pages, confirm the current publishing source, and set/verify `hanksjunkdrawer.com` as this repository's custom domain. Follow GitHub's domain-verification guidance; enable HTTPS once provisioned.
2. In Cloudflare DNS, inspect and replace only obsolete apex/web records. Desired DNS-only A records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; CNAME `www` → `hmarquardt.github.io` (no repository path). Remove conflicting web A/AAAA/CNAME parking records only after inspection. GitHub's configured canonical domain supplies the www redirect.
3. Preserve the R2-managed `data` record, all MX/TXT mail records and registrar nameservers. Verify both app hosts, certificate issuance, and redirects after the migration.

Addresses and procedure checked against [current GitHub documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

Public mail DNS remains: priorities 10 for `eforward1`, `eforward2`, `eforward3`; 15 for `eforward4`; 20 for `eforward5`, all under `registrar-servers.com`. TXT/SPF: `v=spf1 include:spf.efwd.registrar-servers.com ~all`. Nothing in mail configuration was modified.

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
