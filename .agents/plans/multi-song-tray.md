# Pick several songs, then create one set

Status: Approved · 2026-11-17
Issue: #65. Delivery: one PR, three commits (card, tray, wire-up).

## 1. Problem

A new set starts from a single search result: **Start setlist** imports that one song and opens the
set. A 12-song set means 12 searches, and the songs end up in separate sets or get added one by one
afterwards. People know their songs for Sunday up front and want to pick them all, then create the set once.

## 2. Decisions already made

Do not reopen these.

1. **Frontend only.** The issue body (batch title search, `POST /api/search/batch`, rate-limit changes,
   10-title cap, "Add multiple songs" dialog mode) is superseded by the owner's comments. Rewrite the issue
   body to match this plan. No backend, `firestore.rules` or song sheet changes.
2. **Where.** Home search and the navbar search page (`SearchPage.tsx`), but only when it creates a new
   set. With a `targetSessionId` (opened from inside a set) nothing changes: the card keeps
   **Add to setlist** and there is no tray.
3. **The tray is hidden until the first song is added.** It first showed an empty invite
   (**Search and add multiple songs**); the owner replaced that after seeing it built. The two card
   buttons are the cue that several songs can be picked.
4. **Card buttons depend on the tray:**
   - Tray empty: **Add to set** and **Start now**. **Start now** imports only that song
     and ignores the tray (today's behaviour).
   - Tray has songs: only **Add to set**.
   - A song already in the tray shows a disabled **Added** (a label, not colour alone).
   - Emptying the tray brings **Start now** back.
5. **Navbar search copy.** Without a target set, **Extract and view** becomes **Start now**, the same
   label as Home (the owner chose the short form up front).
6. **Duplicates.** Keyed by chart URL. Different versions of one song are allowed.
7. **Cap: 30 songs**, using `SET_LINK_MAX_SONGS` (`src/lib/setLinkSync.ts`) so a tray set can always be
   shared by link or live. At the cap, **Add to set** is disabled and the tray says so in plain words.
8. **Create set** makes one `importSources(sources, { requireAll: true })` call. On failure the whole
   import fails, the tray is kept, and failed songs are marked in it (text, not colour alone) so the
   user can remove them and retry.
9. **Tray layout.**
   - Phone (<640px): a fixed bottom bar once it has songs with the song count and **Create set**; it expands to a list.
     Each row has **Move up**, **Move down** and **Remove**.
   - Tablet and up: inline above the results as wrapping, numbered chips. Each chip has **Move left**,
     **Move right** and **Remove**.
   - No drag. One shared `moveSong(from, to)`. Disabled at the ends, as in `ArrangeDrawer`.
10. **Lifecycle.** Page memory only. No persistence. It survives new searches on the same page.
    Switching to **Paste links** hides it but keeps it.
11. **Card redesign** (shared card, so it shows on every screen that uses it): title one size up, artist
    `text-sm` in `text-ui-text` directly under it, source badge stays top right, version, rating and type
    on one line below.

## 3. Facts checked in the code

- Home: `src/pages/HomePage.tsx:297` passes `label: 'Start setlist'`; `handleCreateFromSearch` imports
  one source and navigates to the new session.
- Navbar search: `src/pages/SearchPage.tsx:262-268` labels the action `Extract and view` when there is no
  target set.
- Card: `src/components/import/SearchResultCard.tsx` has one action button; `SearchResults.tsx` passes
  `getActionState` and `onSelect`.
- `importSources` already takes many sources and writes the session once
  (`src/lib/setlistImport.ts:261`).
- Set sharing limit is 30 (`SET_LINK_MAX_SONGS`); older share paths use 15 and are not affected.
- Existing tests naming the old labels: `srcTest/components/import/SearchResultCard.test.tsx`,
  `SearchResults.test.tsx`, `srcTest/pages/SearchPage.test.tsx:132`, `srcTest/pages/usageEvents.test.tsx:139`.

## 4. Tasks

### T1. Card: readable artist and an optional second action
Files: `SearchResultCard.tsx`, `SearchResults.tsx`, their tests.
- Restyle per decision 11.
- `SearchActionState` gains an optional secondary action (`label`, `onSelect`, `disabled`, `loading`).
  The card renders one or two buttons; two stack on phone widths if they don't fit.
- Test: one button when no secondary action, two when there is; artist is visible text.
Done when: the card looks right in light and dark at 375px and tablet width.

### T2. Tray state and move logic
Files: new `src/lib/useSongTray.ts` (hook, no UI), `srcTest/lib/useSongTray.test.ts`.
- State: ordered `SearchCandidate[]`. API: `add`, `remove`, `move(from, to)`, `has(url)`, `isFull`.
- Test: add, duplicate URL ignored, cap at 30, move at both ends, remove last leaves empty.
Done when: the tests pass and the hook has no DOM code.

### T3. Tray component
Files: new `src/components/import/SongTray.tsx`, `srcTest/components/import/SongTray.test.tsx`.
- Empty text, count, **Create set** (disabled when empty, loading while importing), per-song failed
  marker, phone bar and wide chips, the move and remove buttons with labels naming the song
  (`Move <title> up`).
- Use `ui-*` utilities and shared `Button` / `IconButton`. Respect reduced motion. No hex colours.
Done when: a test shows phone and wide variants render their own move buttons and the failed marker.

### T4. Wire up both pages
Files: `HomePage.tsx`, `SearchPage.tsx`, `srcTest/pages/*`.
- Home and navbar (no target): tray, **Add to set** / **Start now** logic from decision 4,
  **Create set** import, error handling from decision 8, analytics via `trackSongImport('search', ...)`
  with the real counts.
- Navbar with `targetSessionId`: unchanged. Update the old label expectations in tests.
- Test: pick three, reorder, **Create set** makes one `importSources` call in tray order; failure keeps
  the tray; **Start now** ignores the tray; emptying the tray restores two buttons.
Done when: a bug in order or in the single call makes a test fail.

## 5. Checks

```bash
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

Look at Home and the navbar search in light and dark, at 375px and tablet width. `npm run test:emulator`
is not needed. Report anything not checked.

## 6. Not in scope

Drag to reorder, saving the tray between visits, partial import, backend search changes, the in-set
"Add song" dialog, song sheet files.

## 7. HUMAN steps

Rewrite the body of issue #65 to match this plan. Nothing is deployed or pushed by this work. Ask before
the first commit whether it goes on `main` or a branch.
