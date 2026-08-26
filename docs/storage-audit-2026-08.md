# Junkdrawer Browser Storage Audit — 2026-08-26

Repository-wide audit of browser persistence across all root-level pages.
Method: source inspection of every storage code path (keys verified, caps verified, not guessed),
plus a runtime dashboard (`storage-manager.html`) built from these findings.

## Executive summary

The junkdrawer origin hosts ~60 independent single-file apps. Browser storage is per-origin, so
every app's storage shares one quota (~5 MB localStorage; origin quota typically 10 GB+ but
browser-managed for IndexedDB). The audit found:

- **~40 apps use localStorage.** Most correctly store only KB-scale preferences.
- **5 apps are RED**: they store large and/or growing payloads (full-size base64 images, entire
  app state, multi-KB raw API responses) in localStorage.
- **4 apps are ORANGE**: growing histories/caches in localStorage without eviction.
- **24 apps use IndexedDB**; most use it appropriately for bulk data. Several grow unbounded but
  that is tolerable in IndexedDB — the gaps are missing retention policies and a few orphan
  vectors.
- **sessionStorage, Cache API, and service workers: not used anywhere.**
- **Orphaned/abandoned storage** exists from superseded app generations (quack_drawer v1, maiba
  gen 1/2, ADU-Bench gen 1, a dead cross-app handoff key, and a write-only preset key).

**Moving everything to IndexedDB is not the goal.** localStorage and IndexedDB share the origin's
storage budget; the real problems are (a) bulky/growing data in the small synchronous store and
(b) unbounded growth without retention anywhere.

---

## 1. Inventory by application

Risk legend: **GREEN** leave as-is · **YELLOW** improve eventually · **ORANGE** migrate ·
**RED** materially contributes to quota risk.

### RED — migrate now

| App | Storage | Key / DB | Data | Growth | Cleanup | Worst case |
| --- | ------- | -------- | ---- | ------ | ------- | ---------- |
| ai_song_factory.html (SongForge) | localStorage | `songforge_state` | ENTIRE app state as one blob: 3 API keys, projects, lyrics, **generated_images[].image_url full base64 data URLs**, thumbnail data URLs, full model catalogs, prompt templates | Unbounded; rewritten wholesale on nearly every interaction; only ai_jobs(200)/prompt_history(50) capped | Factory reset only | Multiple MB; also leaks 3 API keys in raw state export |
| ai_song_factory.html | IndexedDB | `songforge_images` / `images` | Image Blobs (duplicating the data URLs above) | Unbounded; `deleteImageBlob()` defined but never called → orphans | Factory reset only | 10s–100s MB |
| model_explorer.html | localStorage | `model_explorer_state_v1` | Whole app state: history ≤50 entries each embedding **entire raw API response incl. base64 audio**, full request payload; model catalogs embedding `raw: <full provider object>`; debug log ≤100 | History capped but entries huge; catalog cache ~0.5–2 MB; full-blob rewrite per debug log call | Clear-all + per-provider key clear | Several MB |
| bashful-stegosaurus-stego.html | localStorage | `bashful-stego-history` | Encode history, capped 100 entries but **no byte cap**: JPEG base64 previews (20–80 KB each), full encoded carrier text per entry, plaintext passphrases | Capped count, uncapped bytes | Per-entry delete + clear-all | ≥5 MB in one key |
| bashful-stegosaurus-stego.html | IndexedDB | `bashful-stego-carriers` / `carriers` | Full encoded PNG as raw RGBA ImageData (w×h×4 bytes) | Unbounded | Deleted with history entries | 10s MB |
| collectionofabsurdities.html | localStorage | `collection-of-absurdities:v1` | Unbounded JSON array of items each embedding **full-size base64 image data URLs** | Unbounded count × unbounded bytes; setItem has no try/catch (quota throws uncaught) | Per-item delete; export | Blows 5 MB quota with a handful of photos |
| chat_image_transcriber.html | localStorage | `chatTranscriber` | Settings + history ≤50 sessions, each with up to 3 `imageThumbs` that are **full-resolution data URLs of original screenshots** (not thumbnails); model catalog list | Capped count, uncapped bytes; **setItem not guarded** — quota overflow throws | Session delete | Tens–hundreds of MB attempted → guaranteed QuotaExceededError |

### ORANGE — migrate / add eviction

| App | Storage | Key / DB | Data | Problem |
| --- | ------- | -------- | ---- | ------- |
| dating_pyramid_zeitgeist.html | localStorage | `dpz_source_content_<id>` (one key per source) | Fetched web-page corpora / pasted text, 50 K chars per key, unbounded key count | ~1.3 MB+ realistic; belongs in IndexedDB |
| pontifex-daily-desk.html | localStorage | `pontifexDailyDesk.history.v1` | Run history, **unbounded** push-only array, whole-blob rewrite each run; embeds optional plaintext private phrase | Multiple MB over time; also `rememberedSecrets.v1` (opt-in secrets, plaintext) |
| space-weather-situation-room.html | localStorage | `nasaDonki.cache.v1.<endpoint>.<range>` (one key per range fetched) | Raw DONKI API responses | 30-min TTL is read-side only; **stale keys are never deleted**; unbounded key accumulation → MBs |
| lexical_exhaust_cloud.html | localStorage | `lexical_exhaust_cloud.openrouter_models` | Full OpenRouter catalog embedding `raw` provider objects | ~0.5–1 MB; only used as offline fallback |
| signal-drawer.html | localStorage | `signal-drawer:cache` | Normalized feed articles, wholesale rewrite each refresh | A few hundred KB churn; TTL exists but no byte cap |

### YELLOW — improve eventually (localStorage side fine; retention gaps)

| App | Storage | Notes |
| --- | ------- |-------|
| waypoint-route-builder.html | LS `waypointRouteBuilder.history.v1` | Unbounded history but small text records, full clear/delete UI |
| maiba_rubric_evaluator_deterministic.html | LS draft + backup keys | Whole transcript stored twice (draft + backup) while present |
| local-ai-scratchpad.html | LS `las_history` | Unbounded history blob **only as fallback if IndexedDB fails**; IDB path is correct |
| polymarket_pulse.html | IDB `PolymarketPulseDB` | Time-series stores (orderBooks/snapshots/ticks) pruned **manually only**; fetchLogs/llmAnalyses append-only; needs auto-prune like its news store has |
| crypto-mood-ring.html | IDB `CryptoMoodRingDB` | priceTicks/news auto-pruned (good); llmAnalyses/fetchLogs never auto-pruned |
| the-watchtower.html | IDB `watchtowerDB` | `events` unbounded with full upstream raw JSON embedded; empty vestigial stores `briefs`/`clusters`; LS settings survive "Clear all data" |
| content-radar.html | IDB `contentRadarDB` | items/scans accumulate with no retention cap |
| global-weirdness-radar.html | IDB `globalWeirdnessRadarDB` | articles accumulate permanently; explicit purge exists |
| resume_job_matcher.html | IDB `JunkDrawerResumeMatcher` | evaluations embed full resume + job text + PII, no auto-retention |
| ui-berry-3r-evaluator.html | IDB `berry3r-evaluator` | Opt-in multi-MB MHTML archives unbounded; **per-row delete leaves orphaned `archives` rows** (no cascade) |
| ui-jerry-evaluator.html | IDB `uje-evaluator` | Archives opt-in + cascaded (good); evaluations unbounded but KB-scale |
| gibson-wildlife-wetland-explorer.html | Dexie `GCWWE_DB` | Large GeoJSON layers in IDB (right place); clear+bulkAdd rewrite pattern; localStorage only as fallback |
| wildlife-pattern-lab.html | Dexie `WildlifePatternLab` | `logs` store grows unbounded (no pruning) |
| datecheck.html | IDB `datecheck_db` | Full-resolution base64 images embedded in cases (IDB, right place, uncompressed) |
| atlas-observatory.html | IDB `atlasObservatoryDB` | Imported datasets grow; delete UI exists |
| adubench_verifier.html | IDB `adubenchVerifierDB` | runs unbounded (right place); LS settings ~25 KB ceiling |
| idea-bench.html | IDB `idea-bench-db` | Runs unbounded; delete has no confirm; 23 redundant flat LS keys dual-written with settings blob |
| image-context-inspector.html | IDB `junkdrawer-image-context-inspector` | Original photo Blob per analysis, unbounded, manual clear only — model citizen otherwise (migrated its own LS legacy) |
| openai_image_batch_generator.html | IDB `junkdrawer-openai-image-batch` | Image blobs unbounded, manual purge; correct venue, quota-failure handled |
| whatshouldIeat.html | IDB `whatShouldIEatDB` | Up to 6 image blobs per analysis, unbounded; correct venue |
| gbif_explorer.html | IDB `GBIFExplorerCache` | `searches` store append-only **and its read path is dead code** (write-only cache); `records` store vestigial |
| bashful-stegosaurus-stego.html | see RED | — |

### GREEN — leave alone (representative)

theme/settings/prefs keys across: weather_nerd (capped ID caches, ~40 KB), index.html, analytics-dashboard (8 flat keys), conversation_reverser, kraken_market_radar, domain_taxonomy_verifier, maiba families (LS side), quack_drawer_v2 (capped 100-item history), food-that-doesnt-suck (history capped 5), ADU-Bench-Deterministic (history capped 30 — the model small-history design), rwstime, princton_churches (versioned cache keys), play_editor, manual-party-line, browser-capability-audit, modern-open-agent-stack, china-ai-decel-psyop-explainer, hornet-hru-7, ground-grid-growth, wildlife-field-recorder (largest key is a self-replacing ~150 KB model catalog cache; all bulk data correctly in Dexie), member-review-board (IDB blobs bounded by review size), wildlife-pattern-lab settings.

**No persistent storage at all:** RenderLens, openrouter, first-ring-ai-consultancy, prompt_archaeology, 55plus-group-post-plan, chrome-local-ai-probe, colorado_curiosity_map_fixed, hank_heather_wilderness_safari, markdown_bookmark_gpt, markdown-bookmarklet-builder, native-ai-bookmarklet-builder, questionable_oracle, the-red-flag-forecast, zeitcloud, time-to-click (prefs only), Pontifex settings/secrets keys (see ORANGE for its history).

---

## 2. Orphaned / abandoned storage (reclaimable)

| Item | Owner | Status | Action |
| --- | --- | --- | --- |
| `quack-drawer-import` | written by gbif_explorer.html for a Quack Drawer handoff | **No consumer exists anywhere in the repo**; up to ~300–500 KB; never cleaned | Safe to delete; Storage Manager flags it |
| `gbif-taxa` | gbif_explorer legacy feature | Read/removed by gbif but never written — remnant | gbif self-cleans at startup |
| `quack_drawer_saved_queries` | quack_drawer.html (v1) | Orphaned if user moved to v2 (`qd2_*` namespace, no migration) | Safe to delete after v2 adoption |
| `kraken_radar` (non-v2) | kraken_market_radar predecessor | Superseded by `kraken_radar_v2`; old key never cleaned | Safe to delete |
| `maiba.*` keys + `maibaRubricEvaluatorDB` | maiba generations 1/2 | Gen 3 (`maibaResponseQuality:*`, `maiba-response-quality-db`) shares nothing and never migrates/cleans | Orphaned once gen 3 adopted; contains an OpenRouter key |
| `aduBenchDeterministic.history.v1` | ADU-Bench gen 1 | Superseded by `adubench_verifier.html` (disjoint storage, no migration) | Orphaned once verifier adopted |
| `wgpu_pp_saved` | webgpu-particle-playground | **Write-only dead key** — never read by any code; grows on every preset save | Remove the write or wire a consumer |
| `image-context-inspector-settings` / `-model-catalog` | image-context-inspector legacy | Already self-cleaning at startup | Nothing to do |
| IDB `songforge_images` orphans | ai_song_factory | Blobs whose project/image rows were deleted remain forever (deleteImageBlob never called) | Wire cascade delete |
| IDB `berry3r-evaluator.archives` orphans | ui-berry-3r-evaluator | Per-row history delete skips the matching archive row | Add cascade delete |
| Vestigial stores: `watchtowerDB.briefs/.clusters`, `GBIFExplorerCache.records`, `maiba-response-quality-db.settings` | various | Created but never written | Harmless; candidates for schema cleanup |

---

## 3. Storage architecture guidelines (repo convention)

**localStorage** — small, synchronous, per-origin ~5 MB shared budget:
- Prefs/UI state/settings blobs, selected model, feature flags, IndexedDB schema/version markers.
- Rule of thumb: an app's total localStorage footprint should be **kilobytes, not megabytes**.
- Never store: images/base64/data URLs, imported documents, histories that grow with use, raw
  API responses, large arrays. Cap any array you do persist (see ADU-Bench's `slice(0, 30)`).
- Guard every `setItem` (try/catch) — quota overflow must degrade, not throw uncaught.
- Version your keys (`app.key.vN`) so old payloads are detectable as orphans.

**IndexedDB** — the default for anything that grows:
- Histories, evaluation records, observations, imported datasets, photos/audio (as Blobs, never
  base64 strings), cached AI/provider responses, model catalogs.
- Prefer record-oriented stores (one record per item) over rewriting one giant JSON document.
- Every growing store needs an intentional policy: max count, max age, user-configurable
  retention, or explicit clear UI. Don't invent aggressive auto-deletion where the user expects
  permanent history (evaluations, observations).
- Cascade-delete dependent records (archives with evaluations, blobs with images).

**Credentials**: keys stay out of exports; if persisted at all, treat as opt-in, document it, and
provide a clear/remove control (several apps still lack one).

---

## 4. Prioritized migration plan

1. **P1 — base64 images in localStorage (RED):** collectionofabsurdities (→ IndexedDB),
   chat_image_transcriber (real thumbnails + guarded writes), ai_song_factory (stop persisting
   data URLs; blobs already go to IDB), bashful-stego (byte-cap / offload previews).
2. **P2 — giant state blobs & raw-response embedding (RED):** model_explorer (slim catalog cache,
   strip bulky raw from persisted history), ai_song_factory model_cache slimming.
3. **P3 — recreatable caches (ORANGE):** space-weather stale-key eviction, lexical_exhaust model
   cache slimming, signal-drawer byte cap.
4. **P4 — retention policies (YELLOW):** auto-prune polymarket time-series/fetchLogs, crypto-mood
   llmAnalyses, watchtower events; cascade deletes for berry3r archives and songforge blobs.
5. **Leave alone:** all GREEN preference keys.

## 5. Implemented in this pass

| Fix | App | Change |
| --- | --- | --- |
| Full LS→IDB migration | collectionofabsurdities.html | Items (incl. images as Blobs) move to IDB `collection-of-absurdities` DB; legacy LS array imported, verified, then removed; idempotent via marker; guarded quota handling |
| Real thumbnails | chat_image_transcriber.html | History `imageThumbs` downscaled to ≤160 px JPEG via canvas (~95% size cut); setItem guarded |
| Slim persisted state | model_explorer.html | Model caches stored without `raw` provider objects; persisted history entries strip bulky `raw`/`payload` (kept in-session); base64 audio excluded from persistence |
| Blob-backed images | ai_song_factory.html | Generated-image data URLs no longer persisted in `songforge_state`; rehydrated from `songforge_images` IDB blobs on load; thumbnails stored as blobs too; `deleteImageBlob` wired to deletions; state writes guarded |
| History byte-budget | bashful-stegosaurus-stego.html | History previews downscaled + carrier payloads offloaded to existing IDB carriers store; LS key capped at ~1.5 MB with oldest-entry eviction |
| Cache eviction | space-weather-situation-room.html | Stale `nasaDonki.cache.v1.*` keys evicted on load (7-day max age) |
| History cap | pontifex-daily-desk.html | `history.v1` capped at 200 entries with oldest-eviction |
| Dashboard | storage-manager.html | New Storage Manager (see below) |
| Dead key | webgpu-particle-playground.html | `wgpu_pp_saved` write removed (was write-only, never read) |

Deferred (documented, not forgotten): full ai_song_factory history/projects refactor, dating_pyramid
corpus move, polymarket/crypto/watchtower auto-prunes, berry3r archive cascade. These need
individual attention and UI decisions; none is a localStorage quota emergency after this pass
except dating_pyramid (flagged ORANGE).

---

## 6. Storage Manager design

`storage-manager.html` — single-file app, no dependencies:
- **Overview**: `navigator.storage.estimate()` (usage/quota/%, labeled as estimates), localStorage
  total, IndexedDB usage estimate, persistence status, Cache Storage summary.
- **localStorage inspector**: every key with byte size, readable size, owning app (from an
  embedded ownership map built from this audit), value shape summary (e.g. `Array(1,842 records)`),
  preview, delete-with-confirm; sort by size/key/app; totals and top contributors.
- **IndexedDB inspector**: `indexedDB.databases()` where supported; per-DB stores, key paths,
  record counts (labeled exact), size labeled *unavailable* where the browser gives no number;
  delete-database with typed confirmation.
- **Cache Storage inspector**: caches, entry counts, delete control.
- **Ownership map**: a plain JS object at the top of the script (`APP_MAP`), easy for future
  developers to extend; unknown keys grouped as "Unrecognized".
- **Diagnostics**: largest consumers with risk badges from this audit, orphan suspects (keys no
  current page writes), cleanup opportunities, migration notes.
- **Safety**: every destructive action confirmed; full-origin reset requires typing a phrase.
  Nothing is ever deleted automatically.

## 7. Validation

See `tests/storage-manager.spec.js` and the per-app migration tests added under `tests/`.
Fresh-profile, legacy-profile, idempotency, and no-console-error coverage included.
