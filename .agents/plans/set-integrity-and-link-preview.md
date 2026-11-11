# Sets hold only readable songs; set links open as a preview

Status: Approved · 2026-11-11
Fixes: issue #57. Supersedes `.agents/plans/import-failure-handling.md`.
Delivery: two PRs. **PR A** (tasks A1–A7) fixes #57. **PR B** (tasks B1–B4) adds the set-link
preview and builds on PR A.
Execution: OpenCode `worker` agents (DeepSeek) for the self-contained tasks, Claude as
orchestrator for the `SessionPage` work and for review. See section 5.

## 1. Problem

Paste and search imports save a failed URL as a set item (`status: 'error'`). That one row:

- stops every automatic lyrics update for the set (`buildLyricsSyncPayload` returns `null`),
- makes **Update lyrics** throw (`createSharedLyricsPayload`),
- travels into copies, and
- forces every consumer to decide what an error row means.

Live follow writes a similar "Song unavailable" placeholder. The fix is one rule, kept everywhere:
**every song in a set is a song that loaded.** Failures are reported, never stored as songs.

## 2. Decisions already made

Do not reopen these.

**Sets and imports (PR A)**

1. A set holds only songs that loaded. `SessionSongItem.status` and `errorMessage` are removed,
   and so is every check on them.
2. An import reports failures (including pasted text that isn't a valid URL) and never saves them
   as songs. A new set with no successful songs is **not created**. An add to an existing set with
   no successful songs **writes nothing**.
3. When an import saves at least one song, its failures are stored on the set as
   `Session.importFailures: { url, reason }[]`. The set page shows them in a `StatusBanner`
   ("These links couldn't be added") until the user taps **Dismiss**. Append, de-duplicate by URL,
   cap at 30. Never copied, never shared, no retry.
4. **Add songs › Search:** a failed result button reads **Failed to add** and opens a small
   `OverlayDialog` with the reason. **Add songs › Paste** keeps its `ImportProgressList`.
5. Home page single-result search keeps its inline error (`requireAll: true`, unchanged).
6. Live follow: missing host content is a bug in our code. `applyLiveSet` throws; no placeholder is
   written and no partial set is saved. The follower sees the existing failure state.
7. Old sets: rows with `status: 'error'` are removed once, when sessions load, and their URLs move
   into `importFailures`. Rows with an empty URL (old live placeholders) are dropped.
8. Keep the 60-second failure marker (`recordFailed` / `getFailed`). Delete the unused
   `songCache.removeSong`. A payload build that can't find a song in the cache throws: that is a
   bug, not a case to skip.
9. Empty sets stay allowed (the user can remove every song).

**Set-link preview (PR B)**

10. Opening a set link (`/session/<publicId>` not on this device) always fetches the latest
    version and shows it as a **read-only preview**. Nothing is saved until the user chooses.
11. In the preview, view controls work (font, columns, song navigation). Any edit (key, simplify,
    pad, reorder, edit set, rename, share) opens "Save to your sets to make changes", using the
    same guard pattern as live follow (`useFollowEditGuard`).
12. Preview banner: "You opened a shared set. Save it to your sets?"
    - Not saved before → **Save**.
    - Saved before → **Update my copy** (confirm: "Your changes to your copy will be lost"),
      **Save as new**, **Open my copy**.
13. Changes since the user saved are measured against a snapshot of the link stored on the copy
    when it was saved (`Session.linkSnapshot`), not against the copy's current songs. The banner
    shows counts only: "Since you saved it: 2 songs added, 1 removed, 1 key changed."
14. Fetch fails (offline, expired, missing) and a saved copy exists → open the newest copy with
    "Couldn't load the latest version. Showing your saved copy." No saved copy → the existing
    expired / missing / error screens.
15. Leaving without saving keeps nothing.
16. Preview failures show in the same notice. **Save** keeps only loaded songs and copies the
    failures into `importFailures`. Nothing loaded → error screen, nothing to save.
17. Copy names: one helper `uniqueSetName(name, existingNames)`. Strip a trailing
    ` - Copy` or ` - Copy #n`; return the base if free, else `<base> - Copy #n` with the lowest free
    `n` from 1. Used by **Save as new**, the first **Save**, and **Make a copy**
    (`createSetCopy`, which now gives `Sunday - Copy #1`).
18. Removed: automatic reuse of an existing copy, `force` / `refreshFromSetLink`,
    **Get the latest version**, and the "You already have a copy" banner text.
    `importedFromLinkId` stays so the preview can find "my copy".

## 3. Facts checked in the code (2026-11-11)

- `importSources` builds `items` one per source, error rows included, and appends invalid input
  as more error rows (`src/lib/setlistImport.ts:211-235`). Its returned `failures` **excludes**
  invalid input (`allFailures` is only used for `requireAll`).
- `setLinkImport` intercepts `createSession` to capture `items` and maps them to the link's songs
  by index (`src/lib/setLinkImport.ts:58-86`). Successes-only `items` would misalign it, so it
  must move to per-source outcomes in the same change.
- `createSession` uses `list.unshift`, so `findByImportedLinkId` already returns the newest copy.
- Item status checks: `lyricsSync.ts:48`, `exportLyrics.ts:118`, `setLinkSync.ts:48`,
  `liveShareSync.ts:70`, `liveFollow.ts:63`, `setLinkImport.ts:90`, `SessionPage.tsx` (229, 767-780
  retry, 1542-1544 list badge, 1593-1608 error card). `status: 'ok'` is written in
  `shareSnapshot.ts:27`, `HomePage.tsx:87`, `SessionPage.tsx:193`. `'loading'` is never written.
- `songCache.removeSong` has no callers. **Clear library** wipes songs and sets together.
- `SessionPage` already has an edit guard for followed live sets (`src/lib/useFollowEditGuard.tsx`).

## 4. Tasks

Each task lists the files it **owns**. No two tasks that run at the same time share a file.
"Fails first" names a test that must fail on the code before the task (check by stashing only the
`src/` change).

### PR A — sets hold only readable songs (fixes #57)

#### A1 · Store groundwork — worker

Owns: `src/lib/sessionStore.ts`, `src/lib/songCache.ts`, `srcTest/lib/sessionStore.test.ts`,
`srcTest/lib/songCache.test.ts` (if present).

- Add `export interface ImportFailure { url: string; reason: string }` and
  `Session.importFailures?: ImportFailure[]`, with `MAX_IMPORT_FAILURES = 30`.
- `createSession` option `importFailures`. `addSongsToSession(sessionId, songs, failures = [])`:
  appends songs and merges failures (append, de-dup by URL, keep newest 30). When `songs` is empty
  it returns `{ session, firstNewIndex: session.songs.length }` **without** writing or emitting.
- `dismissImportFailures(sessionId)` clears the field and saves.
- `getAllSessions` migration: move items whose `status === 'error'` into `importFailures`
  (reason = `errorMessage` or `'Import failed'`; skip empty URLs), remove them from `songs`, save
  once. Keep `status` in the type for now (A6 removes it).
- Delete `songCache.removeSong` and its tests.
- Fails first: "addSongsToSession with no songs does not emit", "an old error row moves to
  importFailures".
- Check: `npx vitest run srcTest/lib/sessionStore.test.ts` and `npx tsc -b`.

#### A2 · Import pipeline (lib) — worker, `#max`, after A1

Owns: `src/lib/setlistImport.ts`, `src/lib/setLinkImport.ts`, `srcTest/lib/setlistImport.test.ts`,
`srcTest/lib/setLinkImport.test.ts`.

- Split `importSources` into `loadSources(sources, options)` (cache lookup, failure marker,
  chunked scrape, progress; **no** persistence) and `importSources` (= `loadSources` + persist).
- `loadSources` returns `outcomes: { url, item?, reason? }[]` (one per source, source order),
  `items` (successes only), `failures` (scrape failures **and** invalid input), `imported`,
  `attempted`.
- `importSources` returns `session: Session | null`. New set with zero items → `null`, no
  `createSession`. Existing set → `addSongsToSession(id, items, failures)`; new set →
  `createSession(items, undefined, { importFailures: failures })`. `requireAll` unchanged.
- `setLinkImport`: use `loadSources` (drop the `createSession` interception), map
  `outcomes[i].item` to the link's songs to restore `entryId`, key, simplified and pad settings,
  skip failures, store failures as `importFailures`, and return `{ kind: 'empty' }` when nothing
  loads. Keep the rest of its API as is (PR B replaces it).
- Fails first: "a mixed paste saves only the good songs", "invalid input is in failures, never in
  items", "all-failed new import creates no set", "set-link settings land on the right songs when
  an earlier song fails".
- Check: `npx vitest run srcTest/lib/setlistImport.test.ts srcTest/lib/setLinkImport.test.ts`.

#### A3 · Live follow without placeholders — worker, parallel with A2

Owns: `src/lib/liveFollow.ts`, `srcTest/lib/liveFollow.test.ts`.

- `applyLiveSet` throws `Error('Live set content is missing for a song')` when a manifest entry
  has no content, instead of writing a placeholder. Confirm in the controller that the throw goes
  through the existing failure path, and that no partial set is saved. Report which status the
  follower ends up in.
- Fails first: "a manifest with missing content does not save a placeholder".
- Check: `npx vitest run srcTest/lib/liveFollow.test.ts`.

#### A4 · Share payloads assume readable songs — worker, parallel with A2

Owns: `src/lib/lyricsSync.ts`, `src/lib/exportLyrics.ts`, `src/lib/setLinkSync.ts`,
`src/lib/liveShareSync.ts` and their tests.

- Remove the `status` checks. In `buildLyricsSyncPayload`, a song missing from the cache throws
  (instead of `{ payload: null }`). Confirm `createSyncChannel` catches a throwing `buildPayload`
  and reports a failing status, rather than an unhandled rejection. Keep the `empty` and
  `too_many` reasons.
- Fails first: "a set with an old error row still builds a lyrics payload" (passes once the check
  is gone).
- Check: `npx vitest run srcTest/lib/lyricsSync.test.ts srcTest/lib/exportLyrics.test.ts
  srcTest/lib/setLinkSync.test.ts srcTest/lib/liveShareSync.test.ts`.

#### A5 · Failed to add in search — worker, parallel with A2

Owns: `src/components/editSet/AddSongSearchPanel.tsx`,
`srcTest/components/editSet/AddSongSearchPanel.test.tsx` (new).

- Track failed URLs and reasons. A failed result's button reads **Failed to add**, stays clickable
  and opens an `OverlayDialog` (`size="sm"`) titled "Couldn't add this song" with the reason and a
  **Close** button. Use `ui-*` tokens and the shared `Button`; no hex colours.
- Check: `npx vitest run srcTest/components/editSet/AddSongSearchPanel.test.tsx` and
  `npm run lint`.

#### A6 · Callers, banner and removing `status` — Claude, then worker for test fixtures

Claude owns: `src/pages/HomePage.tsx`, `src/pages/SearchPage.tsx`,
`src/components/editSet/AddSongPastePanel.tsx`, `src/components/SetLinkImportView.tsx`,
`src/pages/SessionPage.tsx`, `src/lib/shareSnapshot.ts`, the `SessionSongItem` type.

- Home / Search: when `session` is `null`, stay and show `ImportProgressList`; don't use
  `?song=` when nothing was added. `AddSongPastePanel`: only select a song when `imported > 0`.
  `SetLinkImportView`: handle `{ kind: 'empty' }` with an error screen.
- `SessionPage`: `importFailures` banner with **Dismiss**; remove **Retry extraction**, the error
  card and the status list badge.
- Remove `status`, `errorMessage` and `'loading'` from `SessionSongItem` and every writer.

Worker (A6b, after Claude's part) owns `srcTest/**` only: drop `status` / `errorMessage` from test
fixtures and fix the tests that asserted error rows. Check: `npm test`.

#### A7 · Verify PR A — Claude

Full check, the "fails first" stash check for each fix, browser check (section 6), then
`graphify update .`.

### PR B — set links open as a preview

#### B1 · Preview library — worker, `#max`

Owns: `src/lib/setLinkImport.ts`, `src/lib/sessionStore.ts`, `srcTest/lib/setLinkImport.test.ts`,
`srcTest/lib/sessionStore.test.ts`.

- `sessionStore`: `uniqueSetName(name, existingNames)` (decision 17), used by `createSetCopy`.
  `Session.linkSnapshot?: { entryId: string; url: string; targetKey?: string }[]`.
  `replaceSongsFromLink(sessionId, songs, linkSnapshot, importFailures)` keeps id, name, publicId
  and published links.
- `setLinkImport`, added **alongside** the old API (B2 deletes the old one):
  - `loadSetLinkPreview(linkId, { onProgress })` → `{ kind: 'preview', preview }` |
    `{ kind: 'expired' }` | `{ kind: 'missing' }` | `{ kind: 'empty' }`; throws on network error.
    `preview = { linkId, name, items, failures, snapshot }`, loaded with `loadSources`.
  - `savePreviewAsNew(preview)` → `createSession` with `uniqueSetName`, `importedFromLinkId`,
    `linkSnapshot`, `importFailures`.
  - `updateCopyFromPreview(sessionId, preview)`.
  - `diffLinkSnapshot(saved, latest)` → `{ added, removed, keyChanged }`, matched by `entryId`.
- Tests: name helper cases (`Sunday`, clash, `Sunday - Copy #1` → `#2`, gaps), diff counts,
  update keeps the id, newest copy is found.
- Check: `npx vitest run srcTest/lib/setLinkImport.test.ts srcTest/lib/sessionStore.test.ts` and
  `npx tsc -b`.

#### B2 · Preview mode in the set page — Claude

Owns: `src/pages/SessionPage.tsx`, `src/components/SetLinkImportView.tsx`,
`src/lib/useFollowEditGuard.tsx`, `src/lib/setLinkImport.ts` (deleting the old API).

- `SetLinkImportView` loads the preview and hands an in-memory set to `SessionPage` (never
  written to IndexedDB). In preview mode, skip every effect that writes or syncs
  (`ensureSetLinkFresh`, share, live, lyrics), and hide **Edit set**, rename and share.
- Generalise `useFollowEditGuard` with a reason (`'live' | 'preview'`), so preview edits open
  "Save to your sets to make changes".
- Banner per decisions 12–14, **Update my copy** confirm dialog, offline fallback to the newest
  copy.
- Delete `importFromSetLink`, `refreshFromSetLink`, `importFromSetLinkOnce`'s `force`,
  **Get the latest version** and the `reused` banner.

#### B3 · Preview tests — worker, after B2

Owns: `srcTest/pages/SessionPage.test.tsx`, `srcTest/components/SetLinkImportView.test.tsx`
(new if missing).

- A link opens as a preview and writes nothing; an edit asks to save; **Save** creates one set;
  with a saved copy the banner shows **Update my copy** / **Save as new** / **Open my copy** and
  the change counts; offline with a copy opens the copy; nothing loaded shows the error screen.
- Check: `npm test`.

#### B4 · Verify PR B — Claude

As A7.

## 5. Running the workers

Track every task as a step in `mcp__helper-desk__plan`. Run workers from the repo root; each gets
its own worktree, and changes land uncommitted only if every `--check` passes.

```bash
python3 ~/.claude/skills/opencode-delegate/scripts/delegate.py --dir . \
  --check "npx vitest run srcTest/lib/sessionStore.test.ts" --check "npx tsc -b" \
  --title "A1 store groundwork" "<brief>"
```

Order:

| Wave | Tasks | How |
| --- | --- | --- |
| 1 | A1 | one worker |
| 2 | A2 (`--model soclaas/x-test-2#max`), A3, A4, A5 | four workers, `run_in_background: true`; file sets are disjoint |
| 3 | A6 (Claude), then A6b (worker) | sequential |
| 4 | A7 | Claude |
| 5 | B1 (`#max`) | one worker, after PR A is merged or on top of its branch |
| 6 | B2 (Claude), then B3 (worker) | sequential |
| 7 | B4 | Claude |

Each brief is self-contained: paste the task's section from this plan, the relevant decisions
from section 2, the code style rules from `AGENTS.md` (Prettier settings, few comments, no hex
colours, original demo lyrics only in fixtures), and "write the fails-first test before the fix".
Review every report: read the diff closely when checks were unchecked or failed, or when risks or
missing items are not "none". Send fixes back with `--session <id> --job <job>`.

## 6. Checks

Before each PR is called done:

```bash
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

No `functions/src/*Store.ts`, cache or `firestore.rules` change is planned, so
`npm run test:emulator` is not needed. Run it if that changes.

Browser, light and dark, at 375px and tablet width:

- PR A: paste three links on Home with one bad → set opens with two songs and the banner;
  **Dismiss** removes it and it stays gone after reload. All bad → no set, list shown. **Add songs**
  › Search failure shows **Failed to add** and the dialog. A set with an old error row loads clean
  with its URL in the banner.
- PR B: open a set link → preview, an edit asks to save, **Save**; reopen → change counts and the
  three actions; **Update my copy** confirm; offline reopen → saved copy with the note.

## 7. Commits

Ask the owner whether this goes on `main` or a branch before the first commit.

PR A:
1. `refactor(session): keep import failures on the set` (A1)
2. `fix(lib): save only songs that loaded` (A2, A6 callers)
3. `fix(lib): never write placeholders for live sets` (A3)
4. `refactor(share): build payloads from readable songs only` (A4)
5. `feat(ui): show why a search result failed to add` (A5)
6. `refactor(session): remove song status` (A6 rest, A6b)

PR B:
1. `feat(session): name copies with a count` (B1 names)
2. `feat(share): open set links as a preview` (B1 rest, B2, B3)

## 8. Done when

- A paste with one bad URL saves only the good songs; the bad URL and reason show in the banner
  until dismissed.
- No code writes a song with a failure status; `SessionSongItem` has no `status`.
- A set that stopped auto-updating because of an old error row publishes again.
- An all-failed import creates no set and navigates nowhere.
- Live follow never writes a placeholder.
- A set link opens as a preview, saves only on request, and reopening shows what changed.
- All checks in section 6 pass, and anything not checked in the browser is listed in the report.

## 9. HUMAN steps

- Merge PR A before starting PR B (or confirm B can stack on A's branch).
- No deploy is needed for PR A or PR B (frontend only). Deploying the site is the owner's call.
