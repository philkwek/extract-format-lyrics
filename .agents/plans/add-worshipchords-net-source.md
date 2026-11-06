# Add worshipchords.net as a paste and search source

Status: implemented locally · 2026-10-25 · deployed reachability check pending

## Goal

Add `worshipchords.net` as a fifth pasted-link source and a fourth concurrent
search source, without changing the existing `worshipchords.com` source.

The two sites share a name but not a domain, an ID, or a page structure. They
must remain separate everywhere, including metrics and UI labels.

### Source count today vs. after

| Path | Today | After |
| --- | --- | --- |
| Pasted / searched links | 4: Ultimate Guitar, PNW Chords, Worship Chords (`.com`), Worship Together | 5: add Worship Chords (`.net`) |
| Live site search | 3: Ultimate Guitar, PNW Chords, Worship Together | 4: add Worship Chords (`.net`) |

`worshipchords.com` has no search adapter today; it is paste-only. The new
`.net` site has a working server-rendered search, so it becomes both.

## What the new site actually serves (verified)

- Search URL: `https://www.worshipchords.net/search?val=<query>`
  - Server-rendered HTML, HTTP 200, no JavaScript required.
  - Up to 25 results, no pagination observed.
  - Results: `div.songlist > a.song-item[href]`; title in `.tit`, artist in `.art`.
  - Zero-result pages still contain the heading `Search result for "…"`, which
    lets the parser distinguish "no matches" from a blocked/changed page.
- Song URL: `https://www.worshipchords.net/<instrument>/<artist-slug>/<song-slug>[-<id>]`
  - Instruments seen: `guitar`, `ukulele`, `baritone-ukulele`, `piano`, `bass`.
    All expose the same chord text; accept any instrument path.
  - Some song URLs have no numeric ID (`/guitar/laura-story/grace`), so URL
    matching must not require one.
- Song page markup:
  - Title: `span.stitle`
  - Artist: `#atname`
  - Current key: `#song-id[data-key]` (fallback `#original-key`, then `.song-key[data-c]`)
  - Capo: `#song-id[data-capo]` (`0` means none)
  - Content: `pre#song-cont`. Chords are in `span.crd.cn`; section labels are in
    `.scrd .crd.cp` (for example `Intro`, `First Verse`, `Chorus 1`).
  - `.text()` on the `<pre>` preserves the chord/lyric line layout; Cheerio
    decodes entities such as `&#039;`.
- `robots.txt` allows the search and song paths; it only disallows `/api/`,
  `/core/`, `/assets/`, `/auth/`, `/users/`, and `/includes/`.
- Reachability caveat: Cloudflare fronts the site. Node's built-in `fetch`
  (undici, what `safeFetchHtml` uses today) received a 403 "Attention Required"
  page, and a burst of requests stayed blocked for roughly 45 seconds.
  This is not necessarily an IP problem: see the transport finding below.

### Transport finding: Crawlee's HTTP engine (Impit) passes

Tested from the same machine, same IP, at the same time:

| Client | Search page | Song page |
| --- | --- | --- |
| Node `fetch` / undici with the current `safeFetchHtml` headers | 403 Cloudflare block | 403 Cloudflare block |
| `impit` with `browser: 'chrome'` | 200, 25 results | 200, chart present |
| `impit` with `browser: 'firefox'` | 200, 25 results | 200, chart present |
| `CheerioCrawler` + `@crawlee/impit-client` (`ImpitHttpClient`, Chrome) | 200, 25 results | 200, chart present |
| `CheerioCrawler` with its default HTTP client (got-scraping) | 200, 25 results | not tested |

A 12-request mixed search/song sequence through Impit also stayed at 200. This
strongly suggests Cloudflare is rejecting the Node/undici TLS and HTTP/2
fingerprint, not the source IP. Impit is the browser-impersonating HTTP client
inside Crawlee; it mimics browser TLS ClientHello, HTTP/2 settings, header
order, and pseudo-header order.

The same Impit test also returned 200 for the existing
`worshipchords.com` chart page, which `safeFetchHtml` currently sees as a 403
Cloudflare challenge. So this transport may be able to revive the `.com`
source too, but that is a separate scope and parser check.

Impit does not solve everything:
- It does not execute JavaScript or solve interactive challenges/CAPTCHAs.
- It does not change the source IP; if Cloudflare starts blocking the IP
  itself, a proxy is still required.
- It does not remove the need for rate limiting, caching, or a circuit breaker.

## Design decisions

1. **Site ID:** use `worshipchords-net`. Keep the existing `.com` ID as
   `worshipchords` to avoid rewriting persisted songs, shared sets, metrics
   history, and cache entries. Add a display alias for legacy
   `worshipchords` values.
2. **Labels:** `Worship Chords (.com)` and `Worship Chords (.net)`. Never show a
   bare "Worship Chords" where the domain matters.
3. **Adapter:** accept every instrument path on the host, but only pages with
   `pre#song-cont`. Artist/index pages produce a clear parse error.
4. **Simplification:** the site has no pre-rendered official simplified chart.
   Keep the existing algorithmic fallback; do not set `simplificationPending`.
5. **Search result limit:** keep the default total at 8. This means each source
   initially gets `ceil(8 / 4) = 2` streamed cards instead of today's 3.
   A 4-source final selection gives Ultimate Guitar its native 3, then rotates
   the remaining 5 slots across PNW, Worship Together, and `.net` (2/2/1).
   Raising the total to 10 would restore 3 cards per source; see Open questions.
6. **Transport:** use Apify's `impit` HTTP client (the engine Crawlee's
   `ImpitHttpClient` wraps) as an optional transport inside `safeFetchHtml`,
   because the existing undici fetch is Cloudflare-blocked on `.net`. Keep the
   existing undici path as fallback. Full Crawlee is not required for a
   request/response app; see the dependency impact section.

## Phase 0 — reachability gate (do this first)

Before building the UI around the source, answer one question from the runtime
that will actually scrape it: can the deployed Cloud Function fetch
`worshipchords.net` reliably at the expected cadence?

1. Add a small throwaway transport check that uses `impit` with
   `browser: 'chrome'` and fetches one search page and one song page from the
   deployed function runtime.
2. Repeat a modest sequence (for example five searches over one minute) to
   check normal operation.
3. Separately, run a burst test (for example ten requests with two seconds
   between them) to find the soft-limit threshold.
4. Record status, body size, and whether `a.song-item` / `pre#song-cont` is
   present. Do not log page content or queries.

The workspace test already showed Impit at 200 while undici was at 403 from the
same IP, so the expected outcome is that the Cloud Function also passes. The
remaining questions are deployment packaging, cold-start behavior, and whether
Cloudflare's rule changes for Google Cloud egress.

If the deployed runtime still gets blocked or pauses after a few requests:
- Do not ship the source as "working"; the UI would show it as unavailable.
- First try a different Impit browser profile (`firefox`) or a recent
  version-specific profile (`chrome142`, `firefox144`).
- If the IP itself is the problem, options are a residential proxy (new
  dependency, cost, privacy/SSRF review), a browser/render service (Crawlee
  `PlaywrightCrawler`/Camoufox plus a proxy), an official API/partner route, or
  leaving the source out. Those are separate decisions, not part of this change.

The existing circuit breaker still degrades a blocked source to "Unavailable"
without hiding other results.

## Implementation

### 1. Registry and identity — `functions/src/urls.ts`

- Add `'worshipchords.net'` to `ALLOWED_DOMAINS`.
- Add `'worshipchords-net'` to `SiteId`.
- Map `'worshipchords.net': 'worshipchords-net'` in `SITE_BY_DOMAIN`.
- No change to `worshipchords.com` or its ID.
- `host.endsWith('.worshipchords.net')` keeps lookalikes such as
  `worshipchords.net.evil.com` and `evilworshipchords.net` rejected.

This is a hard prerequisite: `safeFetchHtml` validates every URL against this
list, so the search adapter cannot fetch the site until this is done.

### 1a. HTTP transport — `functions/src/safeFetch.ts`

Add an optional Impit-backed fetch path instead of replacing the existing one
wholesale. The important rule is: **keep every safety check** in `safeFetchHtml`
and swap only the HTTP call.

- Add `impit` as a production dependency in `functions/package.json` (pin the
  version; it is a native module with Linux x64/arm64 binaries).
- Create one module-level `Impit` instance with `browser: 'chrome'` (or
  `'firefox'`) so warm invocations reuse connections. Do not override its
  generated `User-Agent`/`Accept`/`sec-ch-ua` headers with the old hand-written
  Chrome/122 values; a consistent profile matters more than a recent UA string.
- Extend `SafeFetchOptions` with a transport choice, for example
  `httpClient?: 'undici' | 'impit'`, and use Impit only for the sites that need
  it initially (`.net`, optionally `.com`).
- Impit supports the pieces `safeFetchHtml` relies on: `redirect: 'manual'`,
  `AbortSignal`, per-request `timeout`, streaming `body`, `headers.get()`,
  `status`, `ok`, and `url`. Its `fetch` signature is fetch-compatible, but its
  response type is not the DOM `Response`; define a small structural
  `FetchLike` type rather than casting.
- Preserve the current order:
  1. `checkUrl` allow-list, https, credentials, port
  2. `assertSafeDns` SSRF checks
  3. redirect re-validation with the same max redirects
  4. HTTP status handling (403/429 remain non-retryable and feed the breaker)
  5. content-type check and 2 MB streamed size limit
  6. overall deadline, one retry on 5xx/timeout, metrics
- Add a matching `impit` cookie jar only if Cloudflare starts issuing clearance
  cookies; do not add session/proxy complexity before it is needed.
- Keep the undici path as a fallback and feature-select Impit per site, so a
  native-module or deployment problem cannot break the other sources.

Do not use Crawlee's `CheerioCrawler`/`AutoscaledPool` inside the function:
that duplicates `scrapePool`, `searchCache`, `chartCache`, and `rateLimit`,
adds a storage directory and long-running crawler lifecycle to a serverless
request, and pulls in roughly 114 MB of dependencies in a clean install versus
roughly 9 MB for `impit` alone.

### 2. Song adapter — new `functions/src/adapters/worshipChordsNet.ts`

Export `worshipChordsNetAdapter: SiteAdapter` with `site: 'worshipchords-net'`.

`matches()`: exact `worshipchords.net` or a subdomain. Must return `false` for
`worshipchords.com`; add a regression test for that exact pair.

`extract(html)`:
- Reject Cloudflare/bot pages: `#challenge-error-text`, `.cf-browser-verification`,
  or a title containing `Just a moment` / `Attention Required`. Throw with
  `code: 'BLOCKED'`, matching the existing `.com` adapter.
- Read title, artist, key, capo, and content with the selectors above.
- Section-label normalization: labels such as `First Verse` are not recognized
  by `normalizeSongText` (`Verse 1` and `Chorus 1` are). Before reading the
  `<pre>`, map label text:
  - `intro` → `Intro`
  - `verse` (with `first/second/third` or a number) → `Verse N`
  - `pre-chorus` → `Pre-Chorus`
  - `chorus` → `Chorus` (keep a number if present)
  - `bridge` / `outro` → `Bridge` / `Outro`
  - `interlude` / `instrumental` → `Instrumental`
  - `tag`, `ending`, `refrain`, `turnaround` → append `:` so the normalizer
    treats them as an `Other` header.
  This avoids importing label text as a lyric line and keeps section structure.
- Parse `data-capo` as an integer; only return it when greater than zero.
- If `pre#song-cont` is missing or empty, throw
  `worshipchords.net: Could not locate chord chart content`.

### 3. Register the adapter — `functions/src/scraper.ts`

Add `worshipChordsNetAdapter` to `ADAPTERS` next to the `.com` adapter, before
`genericFallbackAdapter`. `adapterForUrl()` and `scrapeSingleUrl()` then work for
pasted links automatically. No changes to `scrapePool`, `chartLoader`, or
`chartCache`.

### 4. Metrics — `functions/src/metrics.ts`

Add `'worshipchords-net'` to `MetricSite`. `scrapeSingleUrl` passes `sourceSite`
into `recordTiming`, so this keeps type-checking and dashboards explicit.
Do not rename the existing `'worshipchords'` metric series.

### 5. Search adapter — new `functions/src/search/worshipChordsNetSearch.ts`

Export `parseWorshipChordsNetSearchHtml(html)` and
`worshipChordsNetSearchAdapter: SearchAdapter` (`site: 'worshipchords-net'`).

`search(query)`:
- Fetch `https://www.worshipchords.net/search?val=${encodeURIComponent(query)}`
  through `safeFetchHtml`.
- Parse `a.song-item`: `.tit` title, `.art` artist, `href` URL. Results are
  already absolute URLs.
- Set `site: 'worshipchords-net'`, `type: 'Chords'`, dedupe by URL, and cap at
  10 candidates like the other non-UG adapters.
- If the page has a challenge marker, throw `SearchParseError`.
- If the page is neither a valid result page nor a valid zero-result page
  (no `Search result for` heading), throw `SearchParseError`. Returning `[]`
  must mean "the site responded and had no matches", not "the page changed".

### 6. Search host mapping — `functions/src/search/searchSites.ts`

Add `'worshipchords-net': 'www.worshipchords.net'` to `SEARCH_HOSTS`.
This keeps the circuit breaker keyed to the real upstream host, so three
consecutive 403/429 responses pause `.net` only, not `.com` or any other source.

Minor known inconsistency: a pasted bare `https://worshipchords.net/...` uses
`worshipchords.net` as its scrape host key, while search uses
`www.worshipchords.net`. They are separate pause buckets. This mirrors the
existing UG/Worship Together behavior and can be normalized later with a shared
host-key helper.

### 7. Wire search — `functions/src/index.ts`

Append `worshipChordsNetSearchAdapter` to the local `adapters` array. Both the
streaming (`stream=1`) and JSON paths then include it automatically. No route,
request-shape, or CORS change.

### 8. Selection math — `functions/src/search/selectResults.ts`

Change `SUPPORTED_SEARCH_SOURCE_COUNT` from `3` to `4`. This automatically
changes `PARTIAL_SOURCE_RESULT_LIMIT` from `ceil(8/3) = 3` to
`ceil(8/4) = 2`. The frontend imports this same constant from the functions
source, so streaming reservations stay consistent.

### 9. Search cache version — `functions/src/search/searchCache.ts`

Bump `SEARCH_CACHE_VERSION` from `search-v2` to `search-v3`.

Without this, a complete search cached before deployment would keep returning
three sources for up to five minutes. The version bump makes old Firestore and
memory entries unreachable. Chart cache is unaffected; do not bump
`CHART_CACHE_VERSION` because the new adapter does not change existing songs.

### 10. Frontend labels

- `src/lib/searchResults.ts`: add `sourceLabel()` cases:
  - `worshipchords` → `Worship Chords (.com)` (legacy/current .com ID)
  - `worshipchords-net` → `Worship Chords (.net)`
- `src/components/import/SearchResultCard.tsx`: render `sourceLabel(candidate.site)`
  instead of the raw ID, so the badge reads "Worship Chords (.net)".
- `src/components/SongHeader.tsx`: render `sourceLabel(song.sourceSite)` instead
  of the raw ID, so existing `.com` songs and new `.net` songs are unambiguous.
- `src/components/import/PasteUrlForm.tsx`: update the helper text and example
  placeholder to name both domains.
- `README.md` line ~92: update the supported-site list from four to five and
  distinguish `.com` from `.net`.

### 11. Documentation

Update `docs/PERFORMANCE.md`:
- Search fan-out: add Worship Chords (`.net`) to the concurrent sources.
- Streaming cap: `ceil(8 / 3)` → `ceil(8 / 4)` and "three results" → "two results".
- Cache version references: `search-v2` → `search-v3`.
- "all three sources" → "all four sources" in the verification list.
- If the benchmark is extended to four adapters, update the simulated timings
  and the 30/45/60 ms description.

### 12. Tests and fixtures

New fixtures (trimmed real pages, not live requests):
- `functions/srcTest/adapters/__fixtures__/worshipchordsnet.html`
- `functions/srcTest/search/__fixtures__/worshipchordsnet-search.html`
- Optional zero-result fixture for the search parser.

New tests:
- `functions/srcTest/adapters/worshipChordsNet.test.ts`
  - Matches `.net`; does **not** match `.com`.
  - Extracts title, artist, key, capo, and content.
  - Converts `First Verse` into a `Verse` section.
  - Throws `BLOCKED` for a challenge page.
  - Throws for a non-song page with no `#song-cont`.
- `functions/srcTest/search/worshipChordsNetSearch.test.ts` (or extend
  `otherSearch.test.ts`)
  - Parses `.song-item` title/artist/URL/site.
  - Returns `[]` for a valid zero-result page.
  - Throws `SearchParseError` for a challenge page.
  - Caps at 10 and dedupes.
- `functions/srcTest/urls.test.ts`
  - `.net` and `www.worshipchords.net` are allowed and map to
    `worshipchords-net`.
  - `.com` still maps to `worshipchords`.
  - Lookalike hosts are rejected.
- `functions/srcTest/search/selectResults.test.ts`
  - `PARTIAL_SOURCE_RESULT_LIMIT` expectation changes from 3 to 2.
  - Add `.net` to the turn-taking/combined-selection cases.
- `srcTest/lib/searchResults.test.ts`
  - Default four-source reservation now expects 2/4/6/8 cards after each
    source completes, with 2 cards per source at the end.
- Optional: extend `functions/srcTest/benchmark/search-import.benchmark.ts` with
  a fourth adapter and re-run `npm run bench --prefix functions`.

## Dependency and workflow impact

### HTTP transport and deployment

- `impit` is a native Node module (Rust, N-API), not a JS-only package. It ships
  Linux x64/arm64 binaries, so it should run on the Cloud Functions Node 22
  Linux runtime, but verify the Linux binary is present in the deployed bundle
  and measure cold start. A clean install is roughly 9 MB including the native
  binary. Full `crawlee` + `@crawlee/impit-client` was roughly 114 MB in the
  same clean test.
- Keep `safeFetchHtml`'s SSRF/DNS, redirect, size, content-type, timeout, retry,
  and metrics behavior. Impit only changes how the HTTP request is made.
- Impit is a bot-detection-evasion dependency. Review the site's terms and keep
  request volume low; TLS impersonation is not a license to crawl aggressively.
- If the native module cannot be deployed or cold-starts poorly, fall back to
  undici and treat `.net` as unavailable; do not block the rest of the app.
- The same transport also returned 200 for `worshipchords.com` where undici gets
  a 403. Reviving `.com` is a separate follow-up: verify its adapter selectors,
  add fixtures, and decide whether to use Impit for both worship sites or only
  `.net` first.

### Search fan-out

- One additional upstream request per uncached search (3 → 4, +33%).
- Requests still start in parallel via `Promise.all`; the common-case latency is
  set by the slowest source, not by the number of sources. A slow `.net`
  response can delay the final `complete` event up to the existing 10 s fetch
  timeout, but streamed results from the other sources remain usable.
- More sources means `partial: true` is slightly more likely (any source can
  fail). The UI already shows "Some sources are unavailable" and keeps the rest.
- Per-IP rate limits are unchanged, so users do not get more searches. The
  additional load is one request per source per uncached query, reduced by the
  five-minute search cache.
- Cloudflare on `.net` is burst-sensitive. The existing 5-minute search cache
  and 6-hour chart cache suppress repeat traffic. If Phase 0 shows 403 bursts,
  add a per-host search gate (reuse `HostConcurrencyGate`) with a limit of 1–2
  around `adapter.search()`. The circuit breaker then pauses `.net` for ten
  minutes after three consecutive 403/429 responses, without touching others.

### Per-source result visibility

- With `DEFAULT_SEARCH_RESULT_LIMIT = 8` and four sources, the streamed
  per-source cap drops from 3 to 2. A fast source can no longer fill three of
  the eight reservation slots.
- Final composition: Ultimate Guitar's native first three, then PNW / Worship
  Together / `.net` rotating through the remaining five. At least one `.net`
  result is expected when it returns matches, but it does not get a fixed slot.
- If preserving three streamed cards per source matters, raise the total limit
  to 10 instead of changing the per-source cap back to 3. That is a product
  decision, not a requirement of the new source.

### Rate limiting and circuit breakers

- IP limits, scrape concurrency (2), and per-host scrape concurrency (2) are
  unchanged.
- `.net` gets its own host bucket. A Cloudflare block on `.net` cannot pause
  `.com`, PNW, Worship Together, or Ultimate Guitar.
- Search and scrape share the same host-level failure policy (403/429); the
  search path uses `www.worshipchords.net`, the scrape path uses the pasted
  hostname. See the minor inconsistency in step 6.

### Caches

- Search cache: bump to `search-v3`; old complete entries cannot hide the new
  source. Existing HTTP/CDN responses may still serve a three-source result for
  up to the five-minute `Cache-Control` window. Acceptable; purge the CDN if an
  immediate cutover is required.
- Chart cache: no version bump and no schema change. New `.net` charts are
  stored like any other source; old charts are unaffected.
- Browser `songCache`/IndexedDB: no migration. `sourceSite` is a string; the
  new value is display-only.
- Host spelling: search results use `www.worshipchords.net`, while a pasted
  bare `https://worshipchords.net/...` stays bare in testing (no redirect).
  `canonicalChartUrl`, `normalizeSongUrl`, and `canonicalCandidateUrl` do not
  strip `www`, so the same chart can be fetched or cached twice under the two
  spellings. This is a small duplication, not a correctness issue. Optional:
  normalize `www.` for this domain, or rely on a site redirect if one appears.

### Metrics and UI

- New metric series `site=worshipchords-net` for search, fetch, parse, cache,
  and scrape events. Existing dashboards continue to show `worshipchords` for
  `.com`. Add the new series to any panel that enumerates sources.
- Source chips and result badges gain a fourth entry; the UI already lays out
  chips with `flex-wrap`.
- Labels distinguish `.com` from `.net`; no bare "Worship Chords" remains in
  user-facing source text.
- No API response shape change. `site` is already a free-form string, and
  unknown values fall back to the raw label in old clients.

### Deployment order

Deploy Functions and Hosting together. Backend-first is safe: an old frontend
reserves three cards per source and ignores the extra source until the final
selection. Frontend-first is also safe but briefly under-fills streamed cards
because it reserves for a source the old backend does not yet call. Deploying
together avoids both transient states.

No new secrets, Firestore rules, indexes, or cloud resources are required.
A new production npm dependency (`impit`) is required if the transport change is
included; verify the Firebase Functions deployment size and Linux binary.

## Rollout and verification

1. Phase 0 reachability check from the deployed runtime.
2. Unit tests and builds:
   - `npm run test:functions`
   - `npm run test`
   - `npm run lint`
   - `npm run build`
   - `npm run build:functions`
3. Live smoke tests:
   - `GET /api/search?q=goodness%20of%20god&stream=1` shows four source chips and
     `.net` candidates.
   - Paste `https://www.worshipchords.net/guitar/bethel-music/goodness-of-god-169394`:
     title `Goodness Of God`, artist `Bethel Music`, key `G`, sections
     Intro/Verse/Chorus, algorithmic simplified sections present.
   - Paste the `piano` and `ukulele` variants: same chart text.
   - Paste a `.com` link: still treated as `worshipchords`, unchanged.
   - Paste `https://worshipchords.net.evil.com/...`: rejected as unsupported.
4. Monitor for 24 hours:
   - `search.site` / `chart.fetch` for `site=worshipchords-net`
   - blocked/timeout rates and `cooldown_remaining_seconds`
   - `.net` candidate contribution to completed searches
5. Rollback:
   - Remove `.net` from `ALLOWED_DOMAINS`, `SITE_BY_DOMAIN`, `SiteId`,
     `SEARCH_HOSTS`, and the `adapters` array; delete the two adapter files.
   - Revert the constant/cache version and tests.
   - Persisted songs with `sourceSite: 'worshipchords-net'` remain viewable via
     the label map; no data migration is needed.

## Resolved decisions

1. **Result limit:** keep 8 total, so each source reserves two streamed cards.
2. **Site ID:** keep `.com` as `worshipchords`; new `.net` is
   `worshipchords-net`.
3. **Instrument links:** accept every instrument path.
4. **Transport packaging:** use `impit` directly inside `safeFetchHtml`; do not
   add Crawlee.
5. **Sources on Impit:** both `.com` and `.net`.
6. **Search gate:** not added yet. Re-check after the deployed Phase 0 burst
   test; add the existing `HostConcurrencyGate` only if production shows 403s.
