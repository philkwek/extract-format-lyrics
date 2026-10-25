# Search and import performance

This document describes the search/import pipeline, its caches and budgets, and how to reproduce the local measurements. Numbers in this document are simulated scheduling measurements unless explicitly labelled live.

## Search flow

1. The browser calls `GET /api/search?q=...&stream=1` with `Accept: application/x-ndjson`.
2. The backend checks an instance-local and Firestore-backed search cache.
3. On a miss, Ultimate Guitar, PNW Chords, Worship Together and Worship Chords (`.net`) start concurrently.
4. Each completed source is streamed as an NDJSON `source` event; the browser appends its candidates without moving cards already on screen. Each source is initially capped at two results (`ceil(8 / 4)`), reserving slots for slower sources.
5. The backend emits a final `complete` event using Ultimate Guitar’s native first three results plus the balanced selection for other sources. The browser adopts that composition while preserving the position of cards already shown.

The ordinary `GET /api/search?q=...` JSON response remains available for cached/simple clients.

The two Worship Chords domains are fetched through Impit, which imitates a browser TLS/HTTP2 fingerprint. Cloudflare fronts both sites and rejects Node’s default undici fingerprint. Other sources keep the built-in fetch. If the Impit native module cannot load, the function falls back to undici without affecting the other sources.

### Result selection

Ultimate Guitar’s first three accessible results are used directly in payload order.

For PNW Chords, Worship Together and Worship Chords (`.net`):

1. Candidates that match no query token are dropped when at least one relevant candidate exists.
2. Canonical URLs are de-duplicated (tracking parameters and fragments removed, meaningful parameters such as `version` and `simplified` kept).
3. Candidates are ordered within their own source by relevance and then source-local rating. Ratings from different sites are never compared.
4. The remaining sources take turns for the leftover capacity.

The default total limit remains eight.

### Ultimate Guitar ordering

Ultimate Guitar’s own result order is treated as authoritative for that source:

- The adapter filters inaccessible Official/Pro and non-chord rows, then keeps the **first three accessible results** in payload order.
- The backend does not apply relevance/rating re-sorting to those UG results.
- PNW Chords, Worship Together and Worship Chords (`.net`) still use the balanced/relevance selector and fill the remaining capacity.
- Search cache entries are versioned as `search-v3` so older sorted results are not reused.

### Source outcomes

A source reports one of:

- `ok` — results returned.
- `empty` — the source responded successfully with no matches.
- `failed` — `timeout`, `blocked`, `fetch` or `parser` failure.

A failure never hides another source’s results. Three consecutive 403/429 responses pause that host for ten minutes. A successful request resets the failure count. “No matches” does not count as a failure.

## Search caches

| Layer | Location | TTL | Notes |
| --- | --- | --- | --- |
| Instance memory | Function process | 5 min complete, 30 s partial | At most 100 entries; oldest evicted first |
| Shared | Firestore `searchCache` | 5 min | Complete results only; document id is a hash of the versioned key |
| In-flight | Function process | Request lifetime | Identical concurrent work coalesces within one instance |

Keys use `search-v3:<lowercase, whitespace-normalised query>`. The original query text is still sent upstream. Bump `SEARCH_CACHE_VERSION` when the selection policy or response shape changes.

Partial results and failed-site results are intentionally short-lived and are not written to Firestore. A failed site is never persisted as a long-lived legitimate empty result. Cache-store failures degrade to a normal upstream search.

Duplicate suppression in the in-flight map is **instance-local only**. Two instances can still run the same upstream search on a cold cache; Firestore lets later requests reuse whichever result is written first.

HTTP caching matches freshness: complete responses advertise only the remaining TTL; partial responses use `private, no-store`. Streaming responses use `no-cache, no-transform`.

## Import flow

1. The browser validates and de-duplicates pasted/search URLs.
2. `songCache` checks IndexedDB for a song under the requested URL or a redirect alias.
3. An unexpired local failure marker (60 s) is reported immediately; an explicit retry or marker expiry runs the normal path.
4. Uncached URLs are sent in the existing frontend chunks of five URLs.
5. The backend validates every URL, then fills a continuously running two-worker queue. A finished song immediately starts the next queued URL. Results keep input order.
6. Each scrape checks the shared source-chart cache, then fetches/parses/normalises only on a miss.
7. Successful songs are saved to IndexedDB with an alias from the requested URL to the final URL.

### Backend source-chart cache

| Data | Collection | Version | TTL | Notes |
| --- | --- | --- | --- | --- |
| Normalised source `Song` | `sourceCharts` | `chart-v1` | 6 h | Source data only; edits, preferences and sessions are stripped |
| Requested → final URL | `chartAliases` | `chart-v1` | 24 h | Followed only after allow-list validation |
| Official simplification | `chartSimplifications` | `simplification-v1` | 6 h success / 5 min unavailable | Coalesced and reused across users |

Chart keys use canonical URLs (host case, tracking parameters and fragments removed; meaningful query parameters kept). Cache documents larger than 700 KB are skipped. Cache reads still call `checkUrl`, and alias targets are validated again. Identical concurrent scrapes coalesce within one instance. Cache read/write failures fall back to live extraction.

All three collections are covered by the repository-wide Firestore deny-all rule; only the Admin SDK in the function can access them.

### Concurrency and fairness

- Frontend: one scrape request at a time, each containing up to five URLs.
- Backend queue: two workers per `/api/scrape` request.
- Per-host gate: at most two active requests per host **per instance**, shared by overlapping API requests.
- Function platform: `concurrency: 5` per instance, `maxInstances: 3`.

The per-host gate is deliberately instance-wide rather than request-wide. It is not a global distributed lock across instances.

## Fetch budget

`safeFetchHtml` uses one overall deadline (default 10 s). The same deadline covers:

- URL validation and DNS;
- every redirect;
- response headers;
- body streaming and size checks;
- retry backoff and the retry attempt.

Timers and readers are released on every exit path. Active fetch/body work is aborted on timeout. DNS cannot be cancelled in Node; the request stops awaiting it at the deadline and attaches a rejection handler to the late settlement.

One retry is allowed for timeouts and 5xx responses, with a 300 ms backoff, only when it fits in the remaining budget. Invalid URLs, blocked destinations, invalid content types and oversized responses are never retried. Payload, URL and SSRF protections are unchanged.

## Optional official simplification

Ultimate Guitar’s original chart is returned and displayed immediately. If the source advertises a simplified version:

1. The scraper stores the algorithmic fallback (when chords changed) and sets `simplificationPending: true`.
2. It does **not** wait for `?simplified=1`.
3. The session page calls `POST /api/simplify` lazily with the selected song URL.
4. Only `simplifiedSections`, `simplifiedSource` and `simplificationPending` are merged.
5. Official content never replaces an already official chart. A failed request leaves the original or generated chart usable.

The endpoint coalesces identical requests, caches successes and short-lived unavailability, and updates the shared source chart so later imports receive the official simplification. User edits, selected song, transpose state and session changes are untouched. Charts with user-edited simplified sections are not replaced.

## Reproduce the local benchmark

```sh
npm run bench
```

The benchmark uses Vitest with controlled timers and the existing search/adapter fixtures. The search sample delays network at 30/45/60 ms and runs the real `searchSite`/`searchSites` code. The import sample uses 12 songs, one slow item, 100 ms-scale durations, and the real `scrapeUrls` worker pool; the fixed-batch baseline is a controlled simulation of the previous pair loop.

### Simulated results

Environment: macOS Darwin arm64, Apple M4 Pro, Node v22.15.1, 19 October 2026.

| Scenario | Samples | Median | p95 |
| --- | --- | --- | --- |
| Search, previous sequential sites | 40 | 139.77 ms | 142.94 ms |
| Search, concurrent sites | 40 | 61.74 ms | 62.71 ms |
| Import, previous fixed pairs | 12 | 33.89 ms | 38.17 ms |
| Import, continuous worker pool | 12 | 29.91 ms | 31.53 ms |

These are **simulated scheduling** results. They show that concurrent search removes serial waiting and that the worker pool reduces idle time when one song is slow. They are not production latency, upstream response times, or user-perceived timings.

### Live measurements

The backend emits structured Cloud Logging lines with `"type":"perf"` and only bounded fields: operation, supported site identifier, duration, outcome, cache status, attempt count and retry outcome. No queries, titles, lyrics, URLs, session IDs or private content are logged. Disable logging with `PERF_METRICS=0`.

For `search.site`, `outcome: "blocked"` includes `block_reason: "upstream_rejected"` when an actual request receives HTTP 403/429, or `block_reason: "host_paused"` when the circuit breaker skips the request. Rejections include `upstream_status` and, only when the source supplies a valid `Retry-After` header, `retry_after_seconds` (numeric seconds or an HTTP date converted to seconds). Pauses include `cooldown_remaining_seconds` instead. Logged delays are rounded up and bounded to zero through seven days; these diagnostic fields do not change request pacing or the circuit-breaker policy. Response bodies and other headers are not logged.

The frontend reports `search_timing` to the existing GA4 stream with entry page, outcome, result count and bounded duration. It does not include the query.

No live production measurements were taken for this change. Establish a baseline in Cloud Logging/GA4 before and after deployment if production evidence is required.

## Controlled browser verification

The workflow was exercised locally with Vite and a temporary mock `/api` server (controlled timers and fixed Song fixtures):

- all four sources successful and displayed with per-source counts;
- one source failed while the other results remained usable;
- first source results selectable while slower sources were still pending;
- first import, then a repeat import from IndexedDB with no additional scrape request;
- a multi-song import with a slow second song preserved order;
- original chart displayed before the delayed official simplification, then official content after clicking Simplify;
- a section rename made while enrichment was in flight survived both the enrichment and the simplified/original toggle;
- transient failure followed by a successful Retry extraction.

Browser checks used fixtures only. They do not prove live upstream availability or Firestore behaviour across deployed instances.

## Remaining limitations and deployment notes

- Firestore expiry is logical (expiry timestamps checked on read). No Firestore TTL policy is provisioned by this change; add one for `searchCache`, `sourceCharts`, `chartAliases` and `chartSimplifications` if physical cleanup is required.
- In-flight coalescing and host gates are per instance, not distributed.
- A closed streaming search stops writing and the browser aborts stale requests, but an upstream fetch already in progress is not cancelled server-side.
- Cache versions are code constants. Deploying a version bump makes old documents unreachable; they remain until cleaned up.
- `Song.simplificationPending` and search `sources`/`partial` fields are additive. Old browser cache entries, old cached search documents (different version) and ordinary JSON clients remain compatible.
- Deploy Functions and Hosting together: the frontend calls `/api/simplify` and requests `stream=1`; the JSON fallback keeps search working if only the old backend is live.
- Firestore rules already deny direct browser access, so no rule change is required. No new secrets or cloud resources are needed.
