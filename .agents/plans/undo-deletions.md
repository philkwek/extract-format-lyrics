# Deletions are undoable for 5 seconds

Status: Approved · 2026-11-17
Delivery: one PR, three commits (core, session, home).
Execution: Claude owns the `SessionPage` work. Workers may take T1 and T4, which own disjoint files.

## 1. Problem

Three actions remove data with no way back: **Delete set** (Home), **Remove song** (session song tabs and
the Arrange drawer) and **Remove section** (song sheet). All three are hard deletes: `deleteSession`
filters the stored array and emits `deleted`; `removeSongFromSession` re-reads and rewrites the set;
`handleDeleteSection` overwrites the set item's `custom*Sections`/`custom*Flow`. No snapshot is kept and
no trash exists.

The dialogs try to prevent mistakes ("This can't be undone"), but a confirmation is only useful before
the tap, and it doubles the work for the common case. A short undo window is the better safety net: one
tap, five seconds to change your mind.

There is also an inconsistency to close on the way: the Arrange drawer's trash button removes a song in
one tap with **no** confirmation and no test, while the song tab's ✕ asks first.

## 2. Decisions already made

Do not reopen these.

1. **Surface.** Reuse the existing toast family (`Toast` in `src/components/ui/index.tsx`, driven through
   `ChangeToast`). Bottom-centre, solid raised surface, sr-only `role="status"`, safe-area aware. No new
   toast primitive and no global provider.
2. **Deferred commit.** The item disappears immediately but **nothing is written** until the window ends.
   Expiry commits the deletion; **Undo** drops the pending record and no write ever happens.
3. **One pending deletion at a time.** Starting a new one commits the previous immediately.
4. **The confirmation dialogs stay.** Undo is additional, not a replacement. The Arrange drawer gains the
   missing confirmation so both song-remove entry points behave the same.
5. **Wall clock.** 5000 ms, `setTimeout`. No pause on hover, focus, or a hidden tab.
6. **Leaving the screen commits.** In-app navigation/unmount flushes the pending deletion. A hard reload
   or tab close cannot be awaited, so it cancels the deletion — nothing was written, the item is back.
   No `pagehide` flush.
7. **Copy** mirrors each screen's verb, with one **Undo** button: `Set deleted`, `Song removed`,
   `Section removed`. No countdown digits. A 16px ring drains over the 5 seconds.
8. **One constant**, `UNDO_WINDOW_MS = 5000`, exported from the hook. Not configurable.
9. **Undo covers both song-remove entry points** (song tab ✕ and Arrange drawer).
10. **The last song can never be removed.** Existing `songs.length > 1` guards stay.
11. **Commit failure** puts the item back exactly where it was (it was never deleted) and shows a
    persistent error banner with **Try again**.
12. **No auto-focus** on **Undo**, no Escape handler. The toast is announced politely; the button is
    reachable by tabbing.
13. **The ring** is a 16px stroked circle at the toast's leading edge, draining clockwise via
    `stroke-dashoffset`, `currentColor` (works in both themes), linear. It keeps draining under
    `prefers-reduced-motion` (a progress indicator, not decoration); the toast's slide is disabled there.
14. **Set-delete dialog copy** becomes `"<name>" will be deleted. You can undo for 5 seconds.` The
    live-set variant keeps its sentence and gains the same one. The song and section dialogs never claim
    irreversibility, so they stay as they are.
15. **After Undo, no confirmation toast.** The item reappearing is the feedback.
16. **The live-follow guard fires on the X click**, before the confirmation dialog, for every remove
    entry point — matching today's `guard(() => setPendingRemove(...))` at `SessionPage.tsx:1669`.
17. **One shared hook** (`usePendingRemoval`) owns the pending record and the timer. **No optimistic
    state mutation**: each flow subtracts the pending item at render, so Undo is a pure state clear and
    there is no snapshot to restore. The hook shares timing and toast only; each flow owns its own
    render site.
18. **No new store API.** Undo writes nothing. Commits reuse `deleteSession` and `updateSession`.
19. **The undo toast owns the bottom slot** while a deletion is pending. Host-change and preview-error
    notes are held (rendered as `null`) and reappear after the window closes.
20. **Failure banner** sits in the page's existing banner region: `Couldn't delete "<name>". Nothing was
    removed.` (or `Couldn't remove "<title>".`) with **Try again**, which starts a fresh window.
21. **No global pending store.** State is local to the page, so Q6's "leaving commits" is automatic.
22. **Tests** cover the timer, the undo, the missing Arrange confirmation, and assert **no write happens
    before 5 seconds** — that is what makes them fail on the old code.

## 3. Facts checked in the code (2026-11-17)

- `Toast` (`src/components/ui/index.tsx:265-311`) is presentational: `open`, `message`, `icon`, `actions`,
  `onPause`, `onResume`. It renders the sr-only `role="status"` at line 281 and the visible message is
  `aria-hidden` (302). No timer, no test coverage.
- `ChangeToast` (`src/components/share/ChangeToast.tsx:1-64`) owns the timer: `setTimeout(close,
  durationMs)` with `durationMs = 5000` default, pause on hover/focus, **Show** via `ChangeNote.onShow`
  and a **Dismiss** ✕. It is the right place to grow the undo action and the ring.
- Timer hazard: the effect at `ChangeToast.tsx:29-33` depends on `note` identity, so a note object built
  inline restarts the countdown on every parent render. The undo note must be `useMemo`d on the pending
  record, and the hook's callbacks must be stable.
- `deleteSession` (`src/lib/sessionStore.ts:314-321`) filters `app_sessions` and emits `deleted`; the
  listeners in `main.tsx:9-10` then delete the set-link **secret** (`setLinkSync.ts:344-356`) and the live
  identity. This is why delete-then-restore was rejected: a restored set would get a new `publicId`.
- `removeSongFromSession` (`sessionStore.ts:347-353`) has exactly one caller, `SessionPage.tsx:794`.
- `updateSongItem` (`SessionPage.tsx:178-192`) writes from `sessionRef.current`, so in-window edits are
  included and never clobbered by the commit.
- Local state: `sessions` (`HomePage.tsx:69`), `deletingSession` (73), `handleDeleteSession` (81-86);
  `session`/`songsData` (`SessionPage.tsx:170-172`), `pendingRemove` (160-162), `pendingSectionDelete`
  (163-167), `shownSongs` (333-338), `activeSections` (594-603), `activeFlow` (605-611),
  `withUpdatedSections` (613-620), `handleRemoveSong` (792-801), `handleDeleteSection` (942-965).
- `removeSectionFromFlow` (`src/lib/sectionFlow.ts:30-34`) drops every occurrence and shifts later
  indices — the same function serves the render subtraction.
- Both `.ui-overlay`-based surfaces (dialog and Arrange drawer) trap focus and lock scroll, so they must
  not be open together: the drawer's confirmation closes the drawer first.
- Existing tests that must keep passing: `HomePage.test.tsx:153-188`, `SessionPage.test.tsx:319-359` and
  `:361-389` (dialog still required). `HostChangeToast.test.tsx` is the fake-timer template.
- `HomePage.tsx:490` says `This can't be undone.` — must change.
- Arrange drawer delete has no test and no confirmation: `SessionPage.tsx:2040-2044`,
  `ArrangeDrawer.tsx:129`.

## 4. Tasks

Each task lists the files it **owns**. "Fails first" names a test that must fail on the code before the
task (check by stashing only the `src/` change).

### T1 · Undo core — worker

Owns: `src/lib/usePendingRemoval.ts` (new), `src/components/ui/index.tsx`,
`src/components/share/ChangeToast.tsx`, `srcTest/lib/usePendingRemoval.test.ts` (new),
`srcTest/components/share/ChangeToast.test.tsx`.

- `usePendingRemoval<T>({ onCommit, onError })` returns `{ pending, start, undo }`, all callbacks stable
  (`useCallback` over refs).
  - `start(payload)`: if a record is pending, commit it first (fire and forget, errors go to `onError` for
    that payload); then set the new record and start `setTimeout(UNDO_WINDOW_MS)`.
  - expiry: clear the record, then `await onCommit(payload)`; a rejection calls `onError(payload)`.
  - `undo()`: clear the timer and the record. Never writes.
  - unmount: flush the pending commit from a **0 ms timer**, cancelled if the hook mounts again, so
    StrictMode's double mount does not delete anything in development.
- `Toast` gains `progressMs?: number`. When set, render an `aria-hidden` 16px `motion.circle`
  (`data-undo-ring`) before the icon whose `strokeDashoffset` animates from 0 to the circumference over
  `progressMs / 1000` seconds with `ease: 'linear'`. No spring.
- `ChangeToast` gains `progressMs?: number`, `pauseOnHover?: boolean` (default `true`) and
  `dismissible?: boolean` (default `true`); `ChangeNote` gains
  `action?: { label: string; run: () => void }` while `onShow` keeps working (mapped to `Show`).
- Fails first: "commits at 5000 ms", "undo cancels the write", "a second removal commits the first",
  "unmount commits", "StrictMode remount does not commit", "the undo toast does not pause on hover".
- Check: `npx vitest run srcTest/lib/usePendingRemoval.test.ts
  srcTest/components/share/ChangeToast.test.tsx && npx tsc -b && npm run lint`.

### T2 · Session: remove song + Arrange confirmation — Claude

Owns: `src/pages/SessionPage.tsx`, `srcTest/pages/SessionPage.test.tsx`.

- `handleRemoveSong` disappears. Confirming the dialog calls `songRemoval.start({ entryId, index, title })`.
  The live-follow `guard` stays **in front of the dialog** for both entry points.
- Arrange drawer: `onDelete` opens the same `pendingRemove` dialog instead of deleting. Close the drawer
  when the dialog opens (both use `.ui-overlay`), keeping the `songs.length > 1` guard. The drawer and the
  tab strip both subtract the pending `entryId`.
- Render subtraction: `shownSongs` filters out `songRemoval.pending.entryId`. If `activeIndex` points past
  the shortened list, `setSearchParams({ song })` to the last remaining index at confirm time (today's
  post-commit clamp, moved earlier). Do not fix the existing index-shift behaviour when an earlier song is
  removed.
- Commit: filter `sessionRef.current.songs` and `await sessionStore.updateSession(updated)` (the same path
  as `updateSongItem`), then `setSession(updated)`. This makes `removeSongFromSession` unused — delete it
  and its test, unless the owner objects.
- Error: banner `Couldn't remove "<title>". Nothing was removed.` with **Try again** → `start` again.
- Toast: `<ChangeToast note={undoNote} … progressMs={UNDO_WINDOW_MS} pauseOnHover={false}
  dismissible={false} />`, where `undoNote` is `useMemo`d on `pending` and reads `Song removed` with
  `action: { label: 'Undo', run: undo }`. Suppress `hostNote` and `previewError` while pending (decision 19).
- Fails first: "asks before removing a song from the Arrange drawer" (fails today), "hides the song but
  writes nothing for 5 seconds", "Undo brings the song back and never writes", "commits after 5 seconds".
- Check: `npx vitest run srcTest/pages/SessionPage.test.tsx srcTest/lib/sessionStore.test.ts`.

### T3 · Session: remove section — Claude, after T2

Owns: `src/pages/SessionPage.tsx`, `srcTest/pages/SessionPage.test.tsx`.

- `handleDeleteSection` disappears. Confirming calls `sectionRemoval.start({ index, entryId, title, isSimplified })`.
- Render subtraction: compute the base sections, then
  `activeSections = base.filter((_, i) => i !== pending.index)` and
  `activeFlow = removeSectionFromFlow(baseFlow, pending.index)`, where `baseFlow` is
  `resolveSessionFlow(...)` over the unsubtracted sections. `displayedSong` already follows
  `activeSections`, so the sheet updates with no other change.
- Commit: `updateSongItem(entryId, s => withUpdatedSections(s, filteredSections, nextFlow))`, computed from
  the arrays captured at confirm — identical semantics to today's one-shot handler.
- Same toast, banner and **Try again** shape as T2, with `Section removed` and
  `Couldn't remove "<label>". Nothing was removed.`
- Fails first: "hides the section but writes nothing for 5 seconds", "Undo restores the section and its
  repeated choruses without writing", "commits after 5 seconds, removing every flow occurrence".
- Check: `npx vitest run srcTest/pages/SessionPage.test.tsx srcTest/lib/sectionFlow.test.ts`.

### T4 · Home: delete set — worker, parallel with T2

Owns: `src/pages/HomePage.tsx`, `srcTest/pages/HomePage.test.tsx`.

- `handleDeleteSession` splits: confirm calls `setRemoval.start(deletingSession)`; commit is
  `await sessionStore.deleteSession(id)` then `setSessions(await sessionStore.getAllSessions())`.
- Render `visibleSessions = sessions.filter(s => s.id !== removal.pending?.id)` and use it for the empty
  state, the grid and the **Clear library** visibility.
- Add the toast at page level (Home has none today) with `Set deleted` and **Undo**.
- Error banner above the set list with **Try again**. `handleClearLibrary` during a window is fine: the
  commit becomes a no-op delete.
- Dialog copy per decision 14, for both the normal and live-set variants.
- Fails first: "hides the set but does not delete it for 5 seconds", "Undo brings the set back and never
  deletes", "deletes after 5 seconds".
- Check: `npx vitest run srcTest/pages/HomePage.test.tsx`.

### T5 · Verify — Claude

Fails-first stash check per task, full checks, browser pass (section 6), `graphify update .`.

## 5. Checks

```bash
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

No `functions/src` or `firestore.rules` change, so `npm run test:emulator` is not needed. Run it if that
changes.

## 6. Browser check

Light and dark, 375px and tablet width:

- Home: delete a set → card gone, ring drains, **Undo** restores it in place. Delete again and let it
  expire → gone after reload. Delete and navigate away immediately → gone. Delete and reload inside the
  window → the set is back (decision 6).
- Session: remove a song from the tab ✕ and from the Arrange drawer (confirmation appears now); **Undo**
  both; let one expire.
- Session: remove a section that repeats in the flow, **Undo**, confirm every repeat returns.
- The toast must not cover the last line of the sheet or the bottom chrome, and must sit above the
  floating full-screen button.

## 7. Commits

Ask the owner whether this goes on `main` or a branch before the first commit.

1. `feat(ui): add an undo window with a countdown toast` (T1)
2. `feat(session): undo song and section removal` (T2, T3)
3. `feat(ui): undo deleting a set` (T4)

## 8. Done when

- All three removals hide the item immediately, write nothing for 5 seconds, **Undo** restores it exactly
  where it was, and expiry performs the existing hard delete.
- Removing a song from the Arrange drawer asks first, and its ✕ looks and behaves like the tab's.
- A failed commit puts the item back and offers **Try again**.
- Undoing a set keeps its `publicId`, because nothing was ever deleted.
- No `status`, snapshot or restore code was added; the store API only shrank (or stayed the same).
- All checks in section 5 pass; anything not checked in the browser is listed in the report.

## 9. HUMAN steps

- Say whether this lands on `main` or a branch before the first commit.
- Approve deleting `removeSongFromSession` if the owner wants it kept.
- Deploying the site is the owner's call.

## 10. Implementation notes (2026-11-17)

Deltas from the plan, all reviewed and checked:

- **One hook per page, not per flow.** `SessionPage` uses a single `usePendingRemoval<Removal>` with a
  `kind: 'song' | 'section'` union. Two instances let a song removal and a section removal be pending at
  the same time, which broke decision 3 and hid one of the two **Undo** buttons. There is a test for it
  ("keeps only one removal pending").
- **`Toast`/`ChangeToast` gained `progressKey`.** Without it, a second removal started inside the same
  window left the ring wherever the first one had drained to.
- **The header count reads `shownSongs.length`**, so "2 song(s) in setlist" matches the tabs while a
  removal is pending. It read `session.songs.length` and showed a stale count for five seconds.
- **`removeSongFromSession` is deleted** (only caller removed) and its commit path is
  `sessionRef` → `updateSession`, so edits made during the window are kept.
- **Errors clear on a successful commit**, so a stale "Couldn't remove" banner never outlives the failure.
- **Arrange reorder maps visible indices to set indices only while a song is pending**, falling back to
  plain indices otherwise, so a missing `entryId` cannot silently disable reordering.
- Browser pass (light and dark, desktop 1264px, and the session page at 375px and 820px through
  same-origin iframes): set delete → toast → Undo restores and writes nothing; expiry deletes from
  IndexedDB; song removal hides the tab and Undo restores it with storage untouched; section removal
  drops the Chorus and its repeat, committing `customSections`/`customFlow` only after five seconds;
  the Arrange drawer asks before removing and closes behind the dialog. No console errors.
- Not checked: a real phone/tablet device (the harness has no viewport emulation; the widths above came
  from iframes), and the toast against the floating full-screen button in full-screen mode.
