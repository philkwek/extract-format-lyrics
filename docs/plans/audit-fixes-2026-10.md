# Audit fixes: implementation plan

Source: repo audit of 2026-10-30 (12 findings). This plan is run by an **orchestrator**
(Claude Opus) that hands **one task at a time** to an **implementer** subagent (Claude
Sonnet or Claude Haiku). The implementer does that one task and reports back. The
orchestrator reviews it before starting the next task. Each task says what to change, the
exact code shape, the test to add, and how to know it is done.

## Roles

**Implementer (Sonnet / Haiku):** you are given one task number. Do only that task, using the
rules in section 0. Do not start the next task. Do not edit this plan file.

**Orchestrator (Opus):** runs tasks in the order of the table below, one implementer at a
time (they share one working tree, so never two at once). After each task:

1. Read the implementer's report and `git show --stat HEAD`, then read the full diff.
2. Rerun the three checks from section 0 itself. Do not trust the report alone.
3. Check the diff against the task's "Change" and "Done when". Look for scope creep:
   files the task does not name, reformatted untouched lines, new dependencies.
4. For tasks whose test must "fail on the old code", confirm it: revert only the non-test
   source change (`git stash push -- <source files>`), run that one test file, expect a
   failure, then `git stash pop`.
5. If something is wrong, send the same implementer the specific fix
   (SendMessage), not a fresh agent. After two failed rounds, stop and ask the owner.
6. Keep a running log of task, commit and verdict for the final report.

## 0. Rules for the whole job (implementers)

- **Working tree:** `/Users/philkwek/CodeWorkspace/efl-audit-fixes`, already on branch
  `fix/audit-2026-10`. Start every shell command with
  `cd /Users/philkwek/CodeWorkspace/efl-audit-fixes && ...` and use absolute paths under
  that folder for every file you read or edit. Never touch
  `/Users/philkwek/CodeWorkspace/extract-format-lyrics` (the owner's main checkout).
  Do not create or switch branches.
- **Commits:** exactly one commit for your task, message `fix(<area>): <what>` or
  `refactor(<area>): <what>`, ending with the line
  `Co-Authored-By: Claude <noreply@anthropic.com>`. Do not amend earlier commits. Do not push.
- **Never run** `firebase`, `gcloud`, `gh`, `git push`, or anything that touches the live
  `extract-format-lyrics` project. The Firebase and GitHub CLIs on this machine are logged
  in, so these would really run. Steps marked **HUMAN** are for the repo owner: copy them
  into your report, do not do them.
- **Do not read** `functions/.env` or any other `.env` file. Nothing in this plan needs them.
- **Ignore graphify.** `docs/AGENTS.md`, `.agents/` and `.codex/` mention `graphify`
  commands. Do not run them; use grep and file reads.
- **Stay in scope.** Change only what the task names. No renames, no reformatting of
  untouched lines, no new dependencies, no new config files beyond what a task asks for.
- **Style:** match the code around you. Prettier config is `semi: false`,
  `singleQuote: true`, `trailingComma: all`, `printWidth: 100`. Backend imports use the
  `.js` suffix (`import { x } from './urls.js'`). Frontend imports have no suffix.
  Comment density is low: one short comment only where the reason is not obvious.
- **Tests:** frontend tests live in `srcTest/` mirroring `src/`; backend tests live in
  `functions/srcTest/` mirroring `functions/src/`. Both run from the repo root.
- **After every task run all three, and fix failures before the next task:**
  ```bash
  npx vitest run
  npm run lint
  npx tsc -b && npm run build:functions
  ```
  Baseline before you start: 82 test files, 694 tests, all passing.
- **Stop and report** instead of guessing if a task's "before" code does not match what you
  find, or a fix needs more than the task describes. Make no commit in that case.
- **Report back** to the orchestrator in this shape, and nothing else:
  ```
  Task: <n>
  Status: done | blocked
  Commit: <short hash> (or none)
  Files changed: <list>
  Tests added: <file: test names>
  Checks: vitest <files/tests passed>, lint <ok/errors>, build <ok/errors>
  Fails on old code: <yes, how you checked | not checked>
  Deviations from the plan: <none, or what and why>
  HUMAN steps: <copied from the task, or none>
  ```

### Task order, model and why

| Order | Task | Finding | Model | Why this position |
|---|---|---|---|---|
| 1 | Shared-set import must not overwrite cached songs | #2 | Haiku | Small, isolated, user-facing bug |
| 2 | Retry must not save a stale set | #3 | Sonnet | Small fix, but a timing test in a large page test |
| 3 | Shared song docs get a TTL field | #4 | Sonnet | Fake-Firestore tests need care |
| 4 | Simplify request must not refire on edits | #6 | Sonnet | Effect/ref reasoning; same file as Task 2 |
| 5 | Move `canonicalChartUrl` and use it in the browser | #7 | Sonnet | Needed before Task 6 touches `chartCache.ts`; legacy-key migration |
| 6 | Merge the three server caches' shared code | #8 | Sonnet | Also adds TTL fields for caches (rest of #4) |
| 7 | Rate-limit / search helpers in `index.ts` | #9 | Sonnet | Must land before Task 8 edits `index.ts` |
| 8 | Extraction gets its own function | #5 | Sonnet | Builds on Task 7's helpers |
| 9a | Optional client IP header logging | #1 | Haiku | Harmless, off by default; lets the owner collect data |
| 9b | Real client IP behind Hosting | #1 | Sonnet | **Not run in this pass.** Needs header logs from the owner first |
| 10 | One `updateSongItem` helper in `SessionPage` | #10 | Sonnet | Biggest refactor; after all other `SessionPage` edits |
| 11 | Delete dead code | #11 | Haiku | Trivial |
| 12 | Stop re-simplifying unchanged songs | #12 | Haiku | Trivial |

If a Haiku implementer reports `blocked` or fails review twice, the orchestrator reruns that
task with Sonnet.

### Decisions already made (do not reopen)

- Task 8: the upload function uses `maxInstances: 1, concurrency: 3`.
- Task 8: the production upload URL changes. Stale tabs get a 404 until they reload.
- Task 9: the rate limiter stays in memory, per instance.
- Task 10: state is set before the IndexedDB save, so the screen updates immediately.
- Task 5: legacy cache keys are read and copied, never deleted.
- Task 3: song documents written before this change are left alone (owner decides later).

---

## Task 1: Importing a shared set must not overwrite cached songs (finding #2)

**File:** `src/pages/ShareImportPage.tsx`, line 32.

**Problem:** `for (const entry of snapshot.songs) await songCache.saveSong(entry.song)` replaces
the user's own cached chart for every URL in the shared set. The cache is shared by all of
the user's sets, so their other sets change, and "Restore original" restores to the
sender's copy.

**Change:** save only songs that are not cached yet.

```ts
for (const entry of snapshot.songs) {
  if (!(await songCache.getSong(entry.song.sourceUrl))) await songCache.saveSong(entry.song)
}
```

Do not change anything else. The sender's edits travel in `customSections` /
`customSimplifiedSections` on each session item (see `sessionSongsFromSnapshot` in
`src/lib/shareSnapshot.ts`), so they still arrive.

**Test:** new file `srcTest/pages/ShareImportPage.test.tsx`. Copy the mock setup from
`srcTest/pages/usageEvents.test.tsx` (the `vi.mock('../../src/lib/api', ...)`,
`react-router-dom` `useNavigate` mock and `analytics` mock). Two cases:

1. `getShareApi` resolves a snapshot with one song whose `sourceUrl` is already cached
   (`vi.spyOn(songCache, 'getSong').mockResolvedValue(existingSong)`), so
   `songCache.saveSong` is **not** called.
2. `getSong` resolves `null`, so `saveSong` **is** called once with `entry.song`.

Render `<MemoryRouter initialEntries={['/s/abc']}><Routes><Route path="/s/:shortId" element={<ShareImportPage />} /></Routes></MemoryRouter>`
and `await waitFor(() => expect(navigate).toHaveBeenCalled())` before asserting.

**Done when:** both tests pass, and they fail if you revert the change.

---

## Task 2: "Retry" must not save a stale set (finding #3)

**File:** `src/pages/SessionPage.tsx`, `handleRetry`, around lines 565-614.

**Problem:** after `await scrapeApi([item.url])` (which can take 10+ s), all three branches build
`{ ...session, songs: session.songs.map(...) }` from the `session` captured when the user
clicked. Edits made while the request ran (key change, chord edit) are overwritten in
IndexedDB and on screen.

**Change:** after the `await`, read the latest set from `sessionRef.current` (already kept
in sync at line ~206). Add one small local helper inside `handleRetry`:

```ts
const latest = () => sessionRef.current ?? session
```

Then in each of the three places that build `updatedSongs`, replace `session.songs` with
`latest().songs` and `{ ...session, songs: updatedSongs }` with
`{ ...latest(), songs: updatedSongs }`. Leave the pre-await guard
`if (!session || retryingUrls.has(item.url)) return` as is.

Also set `sessionRef.current = updatedSession` right after each `setSession(updatedSession)`
in this function. That way a second update in the same tick sees it before React re-renders.

**Test:** in `srcTest/pages/SessionPage.test.tsx` (it already mocks `sessionStore`,
`songCache` and `../../src/lib/api`). Add one test:

1. A session with two items: item A has `status: 'error'`, item B is ok with no `targetKey`.
2. Make `scrapeApi` return a promise you resolve by hand (`let resolve!: (v) => void; vi.mocked(scrapeApi).mockReturnValue(new Promise(r => { resolve = r }))`).
3. Click A's Retry button. While the promise is pending, switch to B and change its key
   through the Transpose control (follow how existing tests in this file drive the key
   selector).
4. Resolve the scrape with an ok song. `await waitFor(...)`.
5. Assert the **last** `sessionStore.updateSession` call's argument has item B's
   `targetKey` set **and** item A's `status === 'ok'`.

If driving the transpose UI in a test turns out to be impractical, write the test against
any other edit handler already exercised in this file (for example section rename). The point
is "an edit made during the retry survives".

**Done when:** the test passes and fails on the old code.

---

## Task 3: Shared song documents get a TTL field (finding #4, part 1)

**Background:** Firestore TTL (automatic deletion by time-to-live) deletes only the document
that has the TTL field. It never deletes subcollections. Shared sets and shared lyrics store
their content in a `songs` subcollection that has no `expiresAt`, so that content is kept
forever even after the link "expires".

Both stores use the subcollection name `songs`, so one Firestore collection group (`songs`)
covers both.

**Files:**

- `functions/src/shareStore.ts` line ~180: the `batch.set(...)` for each song. Add
  `expiresAt: Timestamp.fromDate(expiresAt)` to the written object:
  `{ index, entry, expiresAt: Timestamp.fromDate(expiresAt) }`.
- `functions/src/sharedLyricsStore.ts` line ~141: the `transaction.set(songRef, {...})`.
  Add `expiresAt: Timestamp.fromDate(expiresAt)`. Every publish rewrites every song doc, so
  re-publishing extends them together with the root.
- Readers already ignore extra fields (`doc.data().entry`, and the explicit field picks in
  `sharedLyricsStore.get`). Do not change the readers.
- `README.md` line ~159, step 2. Replace it with:
  > 2. Configure Firestore TTL policies on the `expiresAt` field for the `sharedSets`,
  > `sharedLyrics` and `songs` collection groups (`songs` holds the content of both), and on
  > the `ttlAt` field for `searchCache`, `sourceCharts`, `chartAliases` and
  > `chartSimplifications`. The backend checks expiry on read; TTL deletes the data later.
  (The `ttlAt` part becomes true in Task 6.)
- `docs/performance.md` line ~170: replace the sentence about provisioning TTL with one that
  points to the README step and names `ttlAt`.

**Test:** `functions/srcTest/shareStore.test.ts` and `sharedLyricsStore.test.ts` use fake
Firestore objects. Find the existing test for `create` / `publish` and add an assertion that
each song write includes an `expiresAt` equal to the root's `expiresAt`. If no such test
exists, add one with a minimal fake `db` that records `batch.set` / `transaction.set` calls.

**HUMAN (copy into your report, do not run):**
```bash
gcloud firestore fields ttls update expiresAt --collection-group=songs --enable-ttl --project=extract-format-lyrics
```
Song documents written before this change have no `expiresAt` and will never be deleted by
TTL. The owner may want a one-off cleanup script; do **not** write or run one unless asked.

**Done when:** tests pass and both stores write `expiresAt` on every song document.

---

## Task 4: The simplify request must not restart on every edit (finding #6)

**File:** `src/pages/SessionPage.tsx`, the effect at lines ~211-256 that calls `simplifyApi`.

**Problem:** the dependency list is `[currentItem, currentSong, originalSongs]`. Any edit
creates a new `currentItem` object, so the cleanup aborts the in-flight request and calls
`attempts.delete(key)`, and the effect fires a new request. Five key changes while it loads
means five server requests, and each one counts against the rate limit.

**Change:**

1. Derive stable primitives before the effect:
   ```ts
   const simplifyKey = currentItem ? currentItem.entryId || currentItem.url : null
   const simplifyUrl = currentSong?.sourceUrl ?? null
   const simplifyNeeded = Boolean(
     currentSong?.simplificationPending && currentSong.simplifiedSource !== 'official',
   )
   ```
2. Make the effect depend on `[simplifyKey, simplifyUrl, simplifyNeeded]` only.
3. Inside the effect, read everything else from refs at the time it is needed:
   - the item, from `sessionRef.current?.songs.find(i => (i.entryId || i.url) === key)`
     (check `customSimplifiedSections?.length` on that before and after the request);
   - `originalSongs`, from a new `originalSongsRef` kept in sync like `sessionRef`
     (`useEffect(() => { originalSongsRef.current = originalSongs }, [originalSongs])`);
   - the song for `mergeOfficialSimplification`, from `originalSongsRef.current.get(key)`,
     falling back to the latest `songsData` entry inside the `setSongsData` updater (as it
     already does).
4. `songCache.saveSong(mergedSource, item.url)`: use the url found in step 3.
5. In the cleanup, keep `controller.abort()` but only `attempts.delete(key)` if the request
   did not finish (track with a local `let settled = false`, set to true in a `finally`).
   A finished attempt (ok or unavailable) must not be retried just because the user moved
   away and back.

Keep the existing `react-hooks/exhaustive-deps` lint passing. Since refs are used, no
suppressions should be needed. If the linter still complains, stop and report blocked. Do not add a
disable comment.

**Test:** in `srcTest/pages/SessionPage.test.tsx`: an item whose cached song has
`simplificationPending: true`, `sourceSite: 'ultimate-guitar'`. Make `simplifyApi` return a
never-resolving promise. Change the key twice. Assert `simplifyApi` was called exactly once.

**Done when:** test passes and fails on the old code; existing simplification tests still pass.

---

## Task 5: One URL-cleaning rule for browser and server (finding #7)

**Problem:** `src/lib/songCache.ts` `normalizeSongUrl` and `functions/src/chartCache.ts`
`canonicalChartUrl` both strip tracking parameters, but differently. The browser one keeps
`utm_term`, `utm_content`, `ref`, `referrer` and does not sort parameters. `...?ref=home` for a
song already cached misses the browser cache and gets stored twice.

**Change:**

1. Move `TRACKING_PARAMS` and `canonicalChartUrl` from `functions/src/chartCache.ts` into
   `functions/src/urls.ts` unchanged. `urls.ts` has no Firebase imports and the frontend
   already imports it (`src/lib/setlistImport.ts`).
2. Update imports: `functions/src/chartCache.ts`, `functions/src/chartLoader.ts`,
   `functions/src/chartSimplification.ts` and `functions/srcTest/chartCache.test.ts` (move its
   `describe('canonicalChartUrl')` block to `functions/srcTest/urls.test.ts`). No re-export
   from `chartCache.ts`.
3. In `src/lib/songCache.ts`, replace the body of `normalizeSongUrl`:
   ```ts
   export function normalizeSongUrl(input: string): string {
     try {
       const u = new URL(input)
       // upload:// and other non-web ids are keys, not chart URLs.
       if (u.protocol !== 'https:' && u.protocol !== 'http:') return input.trim()
       return canonicalChartUrl(input)
     } catch {
       return input.trim()
     }
   }
   ```
   Import: `import { canonicalChartUrl } from '../../functions/src/urls'`.
4. **Keep old keys readable.** Songs already in users' IndexedDB were saved under the
   old normalisation. In `readSong`, after the direct and alias lookups miss, try the legacy
   key once and migrate it:
   ```ts
   const legacyKey = legacyNormalizeSongUrl(normalizedInput)
   ```
   Keep the old function body as a private `legacyNormalizeSongUrl` (not exported). Change
   `getSong` so `readSong` receives the raw `url` as well. On a legacy hit, `store.set` it
   under the new key and return it. Do not delete the legacy key.
   Without this, a song whose URL has several query parameters would show as blank in
   existing sets.

**Test:** update `srcTest/lib/songCache.test.ts` `normalizeSongUrl` expectations if they
change. Add:
- `?ref=home&utm_term=x` and the bare URL normalise to the same key;
- `upload://upload-123-0-abc` is returned unchanged;
- a song stored under the legacy key for `https://tabs.ultimate-guitar.com/x?b=1&a=2` is found
  by `getSong` and copied to the new key.

**Done when:** all chart-cache and song-cache tests pass.

---

## Task 6: Merge the three server caches' shared code (finding #8, plus rest of #4)

**Problem:** `chartCache.ts`, `search/searchCache.ts` and `chartSimplification.ts` each copy
`database()`, `documentId()`, `persistentStore()` and a "drop the oldest entry" map.
`database()` exists in 5 files. `isExpired` (shareStore) and `isLyricsExpired`
(sharedLyricsStore) are the same function.

**Change:**

1. New file `functions/src/firestore.ts`:
   ```ts
   import { createHash } from 'node:crypto'
   import { getApps, initializeApp } from 'firebase-admin/app'
   import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'

   export function database(): Firestore {
     if (getApps().length === 0) initializeApp()
     return getFirestore()
   }

   export function documentId(key: string): string {
     return createHash('sha256').update(key).digest('hex')
   }

   /** Firestore TTL needs a Timestamp; cache entries keep their numeric expiresAt. */
   export function ttlAt(expiresAtMs: number): Timestamp {
     return Timestamp.fromMillis(expiresAtMs)
   }
   ```
2. New file `functions/src/boundedMap.ts`, a Map that drops its oldest entry past a size:
   ```ts
   export class BoundedMap<V> {
     private readonly items = new Map<string, V>()
     constructor(private readonly max: number) {}
     get(key: string): V | undefined { return this.items.get(key) }
     delete(key: string): void { this.items.delete(key) }
     set(key: string, value: V): void {
       this.items.delete(key)
       this.items.set(key, value)
       while (this.items.size > this.max) {
         const oldest = this.items.keys().next().value
         if (oldest === undefined) break
         this.items.delete(oldest)
       }
     }
   }
   ```
   (Format with Prettier; the one-line methods above are for brevity.)
3. In `chartCache.ts`, `searchCache.ts`, `chartSimplification.ts`, `shareStore.ts`,
   `sharedLyricsStore.ts`: delete local `database()` / `documentId()` and import from
   `./firestore.js` (or `../firestore.js`). Replace each `memory` Map plus `memorySet` with a
   `BoundedMap`. Keep each cache's own validation (`isValidChartEntry`, `isCachedSearchEntry`,
   `isEntryValid`) and its own TTL constants. Those differ on purpose.
4. In each Firestore store's write (`FirestoreChartCacheStore.setChart` and `setAlias`,
   `FirestoreSearchCacheStore.set`, `FirestoreSimplificationCacheStore.set`), write
   `{ ...entry, ttlAt: ttlAt(entry.expiresAt) }`. Readers keep using numeric `expiresAt`.
   Do not change the entry types or bump any cache version.
5. Delete `isLyricsExpired` from `sharedLyricsStore.ts`; import `isExpired` from
   `./shareStore.js` instead. Update `functions/srcTest/sharedLyricsStore.test.ts` to import
   `isExpired` from `../src/shareStore.js` (keep its three assertions).
6. The test files construct these caches with fake stores. They must keep passing without
   change apart from step 5. If one needs a change beyond imports, stop and report blocked.

**Test:** add `functions/srcTest/boundedMap.test.ts`: max 2, set a, b, c, so a is gone and
b, c remain; re-setting b moves it to newest.

**HUMAN:** TTL policies on `ttlAt` for `searchCache`, `sourceCharts`, `chartAliases`,
`chartSimplifications` (same `gcloud firestore fields ttls update` form as Task 3).

**Done when:** `grep -rn "function database" functions/src` returns only `firestore.ts`;
all tests pass. Expect roughly −60 lines net.

---

## Task 7: Remove repetition in `functions/src/index.ts` (finding #9)

**Problem:** the 12-line rate-limit block is pasted six times. The search lookup is written
twice (stream branch ~177-209, JSON branch ~243-254).

**Change:**

1. Above `export const api`, add:
   ```ts
   /** Sends 429 and returns true when the caller is over the limit. */
   function rejectIfLimited(req: Request, res: Response): boolean {
     const limitCheck = rateLimiter.checkIp(clientIpFromRequest(req))
     if (limitCheck.allowed) return false
     res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds ?? 60))
     sendJsonError(res, 429, 'RATE_LIMITED', `Rate limit exceeded. Try again in ${limitCheck.retryAfterSeconds}s`)
     return true
   }
   ```
   Use the `Request`/`Response` types that `limits.ts` uses (`express`). Replace all six
   blocks with `if (rejectIfLimited(req, res)) return`. Keep each block's position: the
   search endpoint checks the limit **after** validating `q`, the others before. Do not
   reorder.
2. Add one search runner and use it in both branches:
   ```ts
   const SEARCH_ADAPTERS = [ultimateGuitarSearchAdapter, pnwChordsSearchAdapter, worshipTogetherSearchAdapter, worshipChordsNetSearchAdapter]

   async function runSearch(upstreamQuery: string, onOutcome?: (outcome: SearchSiteOutcome) => void) {
     const { candidates, outcomes } = await searchSites(SEARCH_ADAPTERS, upstreamQuery, {}, onOutcome)
     return {
       results: selectCombinedSearchResults(candidates, upstreamQuery, DEFAULT_SEARCH_RESULT_LIMIT),
       sources: outcomes.map(toSourceStatus),
       partial: outcomes.some((outcome) => outcome.status === 'failed'),
     }
   }
   ```
   The stream branch passes its existing partial-result callback (the
   `selectNativeSourceResults` / `selectSearchResults` + `write({ type: 'source', ... })` body)
   as `onOutcome`. The JSON branch calls `searchCache.search(query, (q) => runSearch(q))`.
   Import the `SearchSiteOutcome` type from `./search/types.js`.
3. Also extract the duplicated `recordTiming({ operation: 'search.total', ... })` success
   call into a small local function only if it ends up identical in both branches. Otherwise
   leave it.

Behaviour must not change: same status codes, headers, response bodies, event order.

**Test:** there is no handler-level test today. Add `functions/srcTest/index.rateLimit.test.ts`
only if the handler can be invoked with a fake `req`/`res` without starting Firebase
(`onRequest` returns a function you can call directly with `(req, res)`; mock
`./shareStore.js`, `./sharedLyricsStore.js`, `./search/searchCache.js` with `vi.mock` so no
Firestore client is built). One case: 31 POSTs to `/api/share` from one IP, so the 31st gets 429
with a `Retry-After` header. If this needs more than ~60 lines of mocking, skip the test and
say so in your report.

**Done when:** tests, lint and the functions build pass; `index.ts` is about 60 lines shorter.

---

## Task 8: Uploads get their own function (finding #5)

**Problem:** one function serves everything, with `maxInstances: 3, concurrency: 5`, so 15
slots. `/api/extract-sheet` can hold a slot for up to 300 s and is called directly at the
public `cloudfunctions.net` URL. 15 uploads at once (or one script) block search, import and
sharing for everyone.

**Change:**

1. In `functions/src/index.ts`, move the body of the `extract-sheet` branch (from the
   `rejectIfLimited` call to the end of its `try/catch`) into
   `async function handleExtractSheet(req: Request, res: Response): Promise<void>`.
2. Add a second export:
   ```ts
   // Uploads can hold a request for minutes; keep them off the main API's instances.
   export const extractSheet = onRequest(
     { secrets: ['GEMINI_API_KEY'], maxInstances: 1, concurrency: 3 },
     async (req, res) => {
       if (handleCors(req, res)) return
       if (req.method !== 'POST') {
         sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed')
         return
       }
       await handleExtractSheet(req, res)
     },
   )
   ```
   `timeoutSeconds: 300` and `memory` come from `setGlobalOptions`; do not repeat them.
3. Remove the `extract-sheet` branch from `api` entirely, and remove `secrets:
   ['GEMINI_API_KEY']` from `api` (nothing else in `api` uses Gemini; confirm with
   `grep -n GEMINI functions/src/index.ts` after the move).
4. Frontend, `src/lib/api.ts` lines ~309-313:
   ```ts
   const extractSheetEndpoint =
     import.meta.env.VITE_EXTRACT_SHEET_ENDPOINT ||
     (import.meta.env.PROD
       ? 'https://us-central1-extract-format-lyrics.cloudfunctions.net/extractSheet'
       : '/extract-sheet')
   ```
5. `vite.config.ts`: add a dev proxy entry next to `/api`:
   ```ts
   '/extract-sheet': {
     target: 'http://127.0.0.1:5001/demo-chords/us-central1/extractSheet',
     changeOrigin: true,
     rewrite: () => '',
   },
   ```
6. Update any test that asserts the old endpoint string (`grep -rn "extract-sheet" srcTest functions/srcTest`).

**HUMAN:** the first deploy creates a new function, `extractSheet`. The deploy workflow
already deploys all functions. After deploy, check an upload works in production before
deleting anything. The old `api/extract-sheet` route is gone after this change, so a stale
browser tab on the old bundle gets a 404 for uploads until it is reloaded.

**Done when:** builds pass; `api` has no extraction code; tests pass.

---

## Task 9: Count real users, not the Hosting proxy (finding #1). HUMAN STEP FIRST

In this pass the implementer does **9a only**. 9b runs later, once the owner supplies the log lines.

**Problem:** `functions/src/clientIp.ts` takes the **last** `X-Forwarded-For` value. Its own
comment says that on the Firebase Hosting path the last value is a proxy. All app traffic
except uploads goes through Hosting (`/api/**` rewrite), so many users share one 30/minute
counter.

**This task cannot be finished without real header data.** Do it in two parts.

### 9a: add a temporary diagnostic (do this now)

In `index.ts`, inside the health-check branch only, log the headers when an env flag is set:

```ts
if (process.env.LOG_CLIENT_IP_HEADERS === '1') {
  console.info('[client-ip]', {
    xff: req.headers['x-forwarded-for'],
    fastly: req.headers['fastly-client-ip'],
    ip: req.ip,
  })
}
```

Commit this as `chore(api): optional client IP header logging`.

**HUMAN:** set `LOG_CLIENT_IP_HEADERS=1` in `functions/.env`, deploy, open
`https://extract-format-lyrics.web.app/api/health` from two different networks (e.g. Wi-Fi
and phone data), read the two log lines in Cloud Logging, then remove the env var. Paste the
two log lines back to the agent.

### 9b: implement (only after the owner supplies the log lines)

Expected shape on the Hosting path: `xff = "<browser>, <hosting proxy>"`, where the last
entry is in a Fastly / Google front-end range. If the logs show something else, stop and
report. Do not guess.

1. In `clientIp.ts`, add a fixed list of the proxy CIDR ranges observed / published (Fastly
   publishes theirs at `https://api.fastly.com/public-ip-list`; copy the ranges into the file
   with a comment giving the date copied). Use Node's built-in `net.BlockList` (no new
   dependency):
   ```ts
   import { BlockList, isIPv6 } from 'node:net'
   const HOSTING_PROXIES = new BlockList()
   // Fastly public IP list, copied YYYY-MM-DD.
   for (const cidr of [/* ... */]) {
     const [net, bits] = cidr.split('/')
     HOSTING_PROXIES.addSubnet(net, Number(bits), isIPv6(net) ? 'ipv6' : 'ipv4')
   }
   ```
2. Rule: take the list of XFF values. If the last one is in `HOSTING_PROXIES` and there are
   at least two, return the second-to-last; otherwise return the last (today's behaviour).
   A caller on the direct URL cannot spoof this, because the platform appends their real
   address last and it is not a proxy address.
3. Remove the 9a logging.
4. Update the comment at the top of `clientIpFromRequest` to describe the new rule in two
   or three lines.

**Tests** (`functions/srcTest/clientIp.test.ts`; keep every existing case):
- `'198.51.100.7, <an address inside a listed range>'` returns `198.51.100.7`;
- `'1.2.3.4, 198.51.100.7, <listed proxy>'` returns `198.51.100.7` (caller prefix ignored);
- `'<listed proxy>'` alone returns the proxy (nothing better is available);
- a non-proxy last hop still returns the last hop.

**Done when:** tests pass. In your report, note that the limiter is still per instance, in
memory (up to 3× the stated limit, reset on cold start). That is accepted for now; do not
add Firestore or Redis.

---

## Task 10: One `updateSongItem` helper in `SessionPage` (finding #10)

**Problem:** `src/pages/SessionPage.tsx` is 1,664 lines. About 20 handlers repeat
"map `session.songs`, build `{ ...session, songs }`, `await sessionStore.updateSession`,
`setSession`". Each reads `session` from its own render, which is how Task 2's bug happened.

**Change (this task only, no other restructuring):**

1. Add near the top of the component, after `sessionRef`:
   ```ts
   /** Saves a change to one set item, always starting from the latest set. */
   const updateSongItem = useCallback(
     async (entryId: string | undefined, change: (item: SessionSongItem) => SessionSongItem) => {
       const latest = sessionRef.current
       if (!latest) return null
       const updated = {
         ...latest,
         songs: latest.songs.map((item) => (item.entryId === entryId ? change(item) : item)),
       }
       sessionRef.current = updated
       setSession(updated)
       await sessionStore.updateSession(updated)
       return updated
     },
     [],
   )
   ```
   State is set **before** the await so quick successive edits compose and the screen
   updates immediately. This changes the order from today (save, then set). That is intended.
2. Convert every handler whose update is "change one item by `entryId`" to call
   `updateSongItem`. From the audit these are: `handleUpdatePrefs`, `handleSelectKey`,
   `handleResetKey`, `handleChangePadKeyMode`, `handleSelectCustomPadKey`, `handleRetry`
   (all three branches; this replaces Task 2's local `latest()`), `handleReorderSections`,
   `handleRenameSection`, `handleDeleteSection`, `handleSplitLine`,
   `handleMergeLineWithPrevious`, `handleEditChord`, `handleDeleteChord`, `handleMoveChord`,
   `handleRestoreOriginal`. Read each one first. If a handler changes more than one item or
   the set's own fields, leave it as is and list it in your report.
3. Keep each handler's other work (`setSongsData`, `setOriginalSongs`, `songCache` calls,
   analytics) exactly as it is and in the same order relative to the save.
4. Do **not** move the pad or full-screen logic into hooks in this task. List it as a
   follow-up in your report.

**Test:** all existing `SessionPage` tests must pass unchanged. Task 2's retry test must
still pass. Add one test: two key changes fired back-to-back without awaiting (two clicks in
the same `act`) both end up in the last `updateSession` call (for example song A's key and
song B's key, or key plus pad mode on one song).

**Done when:** `grep -c "sessionStore.updateSession" src/pages/SessionPage.tsx` drops from
~20 to the few handlers you listed as not converted, plus the helper. Expect roughly −150
lines.

---

## Task 11: Delete dead code (finding #11)

Confirm each with `grep -rn "<name>" src srcTest functions` before deleting. Delete only if
the only hit is the definition.

- `src/lib/api.ts`: `searchApi` (lines ~72-86). Keep `searchError`, which `searchApiStream` uses.
- `src/lib/songCache.ts`: `saveAlias` (lines ~93-97).
- `src/lib/sessionStore.ts`: `addSongToSession` (lines ~135-138).

**Done when:** grep shows no references; tests, lint and build pass.

---

## Task 12: Stop re-simplifying songs with nothing to simplify (finding #12)

**File:** `src/lib/songCache.ts` `getSong`, lines ~47-59.

**Problem:** when `simplifySections` changes nothing (`changedCount === 0`), nothing is
saved, so the same work runs again on every read. `loadSessionSongs` reads every song each
time a set opens.

**Change:** remember the "nothing to simplify" result for this page load. Do not add a new
value to `Song.simplifiedSource`; other code treats any value there as "simplified chart
available".

```ts
private readonly nothingToSimplify = new Set<string>()
```

In `getSong`, skip the `simplifySections` call when
`this.nothingToSimplify.has(normalized)`, and add `normalized` to the set when
`changedCount === 0`. In `saveSong`, `this.nothingToSimplify.delete(finalUrl)` so a re-scraped
song is checked again.

**Test:** in `srcTest/lib/songCache.test.ts`, spy on the `simplifySections` import
(`vi.mock('../../src/lib/chords', ...)` with a passthrough returning `changedCount: 0`), call
`getSong` twice for the same URL, and expect one call.

---

## Final step: orchestrator's report to the owner

After Task 12 the orchestrator runs the three checks from section 0 one last time on the whole
branch, then reports:

1. A table: task number, model used, commit hash, files changed, tests added, lines +/−,
   review rounds needed.
2. Every handler or call site deliberately left unchanged (Tasks 7 and 10) and why.
3. The HUMAN steps, in order:
   - Task 3: TTL on `songs.expiresAt`; decide about old song docs without `expiresAt`.
   - Task 6: TTL on `ttlAt` for the four cache collections.
   - Task 8: verify uploads on the new `extractSheet` function after deploy.
   - Task 9a: capture the header log lines so Task 9b can run.
4. Anything that could not be done, with the exact error output.

No push and no pull request unless the owner asks.
