# Keep failed imports out of the setlist

Status: Superseded on 2026-11-11 by `.agents/plans/set-integrity-and-link-preview.md`. Do not
implement this plan.
Scope: paste and search imports (`importSources`). Follow-up to PR #55.
Related plan: `.agents/plans/pr-55-review-fixes.md`

## 1. Problem

Today a failed paste import is saved as a real setlist item:

```ts
{
  url: 'https://example.com/broken',
  status: 'error',
  errorMessage: 'Scrape failed',
}
```

That placeholder is useful — the session page can show the error and offer **Retry extraction** —
but it pollutes the set:

- `buildLyricsSyncPayload` returns `null` if any item is not `ok`, so one failed song silently
  stops every automatic lyrics update for the set.
- `buildSharedLyricsPayload` throws for the same reason, so a manual **Update lyrics** fails too.
- The failed URL counts as a song for display and copying, even though there is nothing to play.
- A copied or shared set carries the failure placeholder with it.

The set should contain only songs that can actually be read. Failures are import results, not
setlist entries.

## 2. What exists today

- `importSources` returns `items` in source order, including `status: 'error'` placeholders, plus
  `failures` and `ImportProgress[]` for the UI (`src/lib/setlistImport.ts`).
- `addSongsToSession` appends every item (`src/lib/sessionStore.ts:235`).
- `createSession` creates a new set from every item, even when all failed.
- `setLinkImport` relies on `items` being aligned one-to-one with the shared set's songs
  (`src/lib/setLinkImport.ts:76`).
- `AddSongPastePanel` already shows each URL and its failure in `ImportProgressList`, so the user
  has immediate feedback. The set placeholder is only needed for retry-after-close.
- `SessionPage` has an error card with **Retry extraction** for `status: 'error'` items
  (`src/pages/SessionPage.tsx:1589-1608`). Keep it for old sets and live-follow failures.

## 3. Decision

**Do not persist failed paste/search imports as `SessionSongItem`s.** Persist only successful
songs. Keep the failure information separately and show it to the user.

This fixes the lyrics-sync block at the source, keeps copies and set links clean, and makes
`Session.songs` mean "playable songs".

## 4. Where the failures live

Pick one; the first is the smallest and is recommended for the first cut.

### A. Transient import result (recommended first cut)

- Keep failures in `ImportSourcesResult.failures` and `ImportProgressList`.
- The Add Song panel already shows them with the URL and reason. If the user closes the panel,
  they can paste the failed URLs again.
- Home and Search navigate away immediately, so carry a short notice in navigation state, e.g.
  `state: { importFailures: { count, urls } }`, and show a banner on the session page.
- No schema change, no migration.

Trade-off: a failure is lost after the panel closes. That is acceptable if retry-after-close is
not a priority.

### B. `Session.importFailures` (if failures must survive reload)

Add a capped list to `Session`:

```ts
export interface SessionImportFailure {
  url: string
  title?: string
  reason: string
  at: number
}

export interface Session {
  // ...
  /** Paste/search URLs that could not be loaded. Not part of the setlist. */
  importFailures?: SessionImportFailure[]
}
```

- `Session.songs` stays clean.
- The session page or Edit Set modal can show "2 songs couldn't be added" with **Retry** and
  **Dismiss**.
- Exclude the field from set copies and set-link/live payloads.
- Cap it (for example 30 entries) and clear entries on a successful retry.
- No new IndexedDB store; it travels with the session.

Trade-off: a schema field that is local metadata, not musical data. Keep it out of every share
path.

### C. Separate `failedImports` store (if failures are global, not per set)

A new IndexedDB store keyed by `{ sessionId?, url }`. More plumbing and a new storage schema. Only
worth it if failures need to be visible outside the session that produced them.

## 5. Import contract changes

`ImportSourcesResult` should make the safe-to-persist list obvious:

```ts
export interface ImportOutcome {
  url: string
  item?: SessionSongItem // present only on success
  reason?: string
}

export interface ImportSourcesResult {
  /** Only successful songs; safe to add to a session. */
  items: SessionSongItem[]
  /** One entry per source, in source order, for callers that need per-source mapping. */
  outcomes: ImportOutcome[]
  /** A new or updated session, or null when a new set would have no songs. */
  session: Session | null
  imported: number
  attempted: number
  firstNewIndex: number
  failures: Array<{ url: string; reason: string }>
}
```

- `items` contains only `status: 'ok'` entries.
- `outcomes` is aligned with the `sources` argument. `setLinkImport` needs this because it maps
  each source's per-song settings (`entryId`, `targetKey`, `simplified`, pad settings) by index.
- Invalid pasted inputs appear in `failures` and `outcomes` with a reason, never in `items`.
- For a new set with zero successes, do not call `createSession`; return `session: null`.
- For an existing set with zero successes, return the existing session without writing. Make
  `addSongsToSession` a no-op when `songs.length === 0`, or add a `getSession` dependency.

## 6. Call sites

| File | Change |
| --- | --- |
| `src/lib/setlistImport.ts` | Build `items` from successes only; add `outcomes`; return `session: null` when a new set has nothing playable. |
| `src/lib/setLinkImport.ts` | Map `payload.songs` through `outcomes[index].item`; omit failures; return a new `failed`/`empty` result when nothing loads. |
| `src/components/SetLinkImportView.tsx` | Handle the new result; show failures instead of navigating to an empty copy. |
| `src/pages/HomePage.tsx` | If `session` is null, show the failure list and stay; otherwise navigate and carry a notice when some failed. |
| `src/pages/SearchPage.tsx` | Same; when adding to an existing set, stay on the page with the failure list if nothing succeeded. |
| `src/components/editSet/AddSongPastePanel.tsx` | `ImportProgressList` already shows failures; stop expecting error rows in the session. |
| `src/components/editSet/AddSongSearchPanel.tsx` | `requireAll: true` already throws; only the result type changes. |
| `src/pages/SessionPage.tsx` | Keep the error card and **Retry extraction** for legacy and live-follow items. New paste imports no longer create them. |

## 7. Legacy sets

Old sets may still contain `status: 'error'` items. Do not drop them silently. Choose one:

1. **Leave them and skip them in share payloads (smallest).** Change
   `buildLyricsSyncPayload` and `buildSharedLyricsPayload` to ignore `status: 'error'` items, as
   `buildSetLinkPayload` already does. The user sees a note that those songs are not included.
2. **Migrate them to `Session.importFailures`** (if option B is chosen) and remove them from
   `songs`. This makes the setlist clean and preserves the URL for retry. Show a one-time notice.
3. **Leave them untouched and keep the lyrics status warning** (the heavier PR #55 appendix).
   This is the least clean data, but it does not silently lose anything.

Recommended: option 1 for the first cut, or option 2 once the failure UI exists. Do not choose
option 3 if the goal is clean set data.

## 8. Tests

- `setlistImport.test.ts`
  - A mixed batch returns only successes in `items` and `session.songs`.
  - `outcomes` stays aligned with the source order.
  - An all-failed new import returns `session: null` and keeps every failure.
  - An all-failed add to an existing set returns the unchanged session and does not write.
  - Invalid inputs never become items.
- `setLinkImport.test.ts`
  - Failed songs are omitted from the copy.
  - Successful songs keep their per-song settings by source order.
  - An all-failed import returns the new failure result.
- Page/component tests
  - Home and Search show the failed URLs and do not navigate to an empty set.
  - Add Song paste shows failures in `ImportProgressList` and adds only successes.
  - A legacy set with an error item still shows **Retry extraction**.
- Session store
  - `addSongsToSession(sessionId, [])` does not emit an update.
- Lyrics/share payloads (if option 1)
  - A legacy set with one error item publishes the playable songs, not `null`.

## 9. Out of scope

- Live-follow `status: 'error'` placeholders. They are the host's unavailable songs, not a paste
  import; keep the placeholder so the follower sees that something is missing.
- `setLinkImport` failures from someone else's set. They can use the same outcome handling, but
  the copy's failure notice is a separate UX decision.
- A full "import history" feature. The failure list is not an audit log.

## 10. Rollout

1. Land PR #55 with the double-fetch fix (and the optional retry) first.
2. Build this import change as its own PR against `main`.
3. If option B or C is chosen, add the failure UI and the legacy migration in the same PR.
4. If option A is chosen, keep the session schema unchanged and carry only a transient notice.

## 11. Done when

- A paste import with one bad URL adds the good songs only; the bad URL is visible with its reason.
- A set containing a failed paste import can publish and auto-update its lyrics without a guard
  blocking everything.
- No new `status: 'error'` item is ever written by `importSources`.
- An all-failed import does not create an empty set or navigate the user to one.
- Old error items still have a retry path, and share payloads handle them deliberately.
