# PR #55 review fixes — implementation plan

Status: Implemented · 2026-11-10 · commits `5c5af26`..`675ca24`
PR: [#55 feat(share): keep lyrics links current and notify readers](https://github.com/philkwek/extract-format-lyrics/pull/55)
Branch: `feat/auto-update-lyrics`
Source: eight review comments, re-reviewed 2026-11-10

The re-review changed the priority: **only the duplicate fetch blocks merging.** Everything
else is worth-knowing or optional polish. This plan reflects that.

## 1. What the re-review changed

- **Fix before merging:** the double fetch on the lyrics page (`lyricsLive.ts`).
- **Downgraded to worth knowing:** silent automatic-update failures (`lyricsSync.ts`). The
  earlier version listed loading songs and missing cache entries; the re-review says those
  cannot really happen. The remaining cases are a dropped connection and the shared rate
  limit.
- **Copy comment:** now says the panel copy is accurate in the normal case, with the same
  offline/rate-limit gap.
- **Worth knowing:** the shared rate limit, deleting a set, and the two floating-button details.
- No new commits. CI still passes (GitGuardian and **Lint, test and build**).

| # | Finding | Re-review severity | Plan |
| --- | --- | --- | --- |
| 1 | `lyricsSync.ts:57` — automatic updates can give up silently | Worth knowing | Task 2: cheap retry; warning is optional |
| 2 | `ShareLyricsLinkPanel.tsx:121` — panel copy | Minor, accurate normally | No change |
| 3 | `lyricsLive.ts:26` — first snapshot causes a second full GET | **Fix before merging** | Task 1 |
| 4 | `main.tsx:11` — shared rate-limit budget | Worth knowing | Task 6: defer |
| 5 | `lyricsSync.ts:88` — deleting a set drops the update secret | Worth knowing | Task 5: document |
| 6 | `SessionPage.tsx:1928` — full-screen exit loses reading position | Worth knowing | Task 3 |
| 7 | `SessionPage.tsx:676` — `querySelector('header')` is fragile | Worth knowing | Task 4 |
| 8 | `SessionPage.tsx:1881` — button may cover the last line at 375px | Worth knowing, visual check | Not planned |

## 2. Status finding

The re-review narrowed this to offline/flaky connections and the daily rate limit. The cheap
retry in Task 2 covers both. Copy-paste import failures are tracked separately in #57 and are
not part of this plan.

One additional silent skip remains: a published set that grows past the 15-song lyrics limit
returns `{ payload: null, reason: 'too_many' }`, and `onSkipped` is not wired. That is noted in
follow-ups, not fixed here.

## 3. Decisions

- **Merge blocker first.** Task 1 only. The rest can follow.
- **Use the cheap retry for the offline/rate-limit case.** It is much smaller than a status
  store and recovers automatically when the leader opens the share panel or comes back online.
- **Skip the first Firestore snapshot.** No server change, no API deploy. Accepted trade-off: a
  publish between the initial GET and the first snapshot is missed until the next change or
  visibility refresh. The `rev` comparison is a follow-up.
- **Do not touch the protected song sheet.**
- **Do not change the rate limiter here.**
- **Keep a deleted set's lyrics link readable until it expires.** Document it.

## 4. Tasks

### Task 1 — Stop the duplicate fetch on open (blocking, comment 3)

**Goal:** opening a lyrics link makes one GET, not two.

**Files**

- `src/lib/lyricsLive.ts`
- `srcTest/lib/lyricsLive.test.ts`

**Change**

- In `subscribeSharedLyrics`, ignore the first snapshot of each subscription:

  ```ts
  let first = true
  const off = onSnapshot(doc(...), (snap) => {
    if (stopped) return
    if (first) {
      first = false
      return
    }
    if (snap.exists()) handlers.onUpdate()
  }, ...)
  ```

- Leave the initial load, cache path and visibility refresh in `LyricsViewerPage` unchanged.

**Tests**

- First existing snapshot does not call `onUpdate`.
- A second snapshot calls `onUpdate` once.
- A first snapshot for a missing document is also ignored; a later existing snapshot updates.
- Update the existing "reports changes" test, which currently expects the first snapshot to
  fire.

**Done when**

- Opening a lyrics link shows one `GET /api/lyrics-share/:id` in the network panel.
- Adding a song still produces one refresh and the existing **Added …** toast.

---

### Task 2 — Retry when the share panel opens or, while it is open, when the browser comes online (recommended, comment 1)

**Goal:** an edit made while offline or rate-limited gets another chance without waiting for the
next edit.

**Files**

- `src/lib/lyricsSync.ts`
- `src/components/share/ShareLyricsLinkPanel.tsx`
- `srcTest/components/share/ShareLyricsLinkPanel.test.tsx` (new)

**Change**

- Export `ensureLyricsFresh(session: Session): Promise<EnsureFreshResult>` from
  `lyricsSync.ts`, mirroring `ensureSetLinkFresh`:
  - lazily create the default sync;
  - call `defaultSync.ensureFresh(session)`;
  - catch and return `{ ok: false, reason: 'failed' }`.
- In `ShareLyricsLinkPanel.tsx`:
  - keep the latest `session` in a ref, so a retry uses current songs even when the modal stays
    open across edits;
  - once a link is published (`isPublished`), call `ensureLyricsFresh(sessionRef.current)` once;
  - add a `window` `online` listener while the panel is open and call it there too;
  - remove the listener on unmount.
  - Do not add a new warning for a failed retry; the manual **Update lyrics** button already
    shows the error.
- `ensureFresh` hashes the payload and no-ops when `lastPublishedHash` matches. The exception
  is a link close to expiry, where it renews the seven days as designed.

**Tests**

- With a published identity, rendering the panel calls `ensureLyricsFresh` once.
- Dispatching `online` calls it again.
- Unmounting, then dispatching `online`, does not call it.
- A failed retry does not change the banner or show an error by itself.

**Done when**

- Open a set with a published lyrics link while offline, make an edit, close the panel, go back
  online, reopen the panel: the link publishes the latest lyrics without pressing **Update
  lyrics**.
- The same recovery happens if the panel is already open when the browser comes back online.
- A panel open with no changes sends no PUT unless the link is due for renewal.

---

### Task 3 — Restore the reading position after full screen (optional, comment 6)

**Goal:** someone who enters full screen from verse 3 returns to verse 3 on exit, not the top.

**Files**

- `src/pages/SessionPage.tsx`
- `srcTest/pages/SessionPage.test.tsx`

**Change**

- Add `const fullScreenScrollYRef = useRef(0)` next to `fullScreenTriggerRef`.
- In `handleEnterFullScreen`, save `window.scrollY` before changing state.
- In `handleExitFullScreen`, inside the existing `window.setTimeout(..., 0)`:
  - keep the current trigger fallback;
  - call `trigger?.focus({ preventScroll: true })` so focus does not scroll the page;
  - call `window.scrollTo(0, fullScreenScrollYRef.current)` after focus.
- The same path covers **Exit full screen** and `Escape`.
- Do not change the full-screen layout, the scroll container or the protected sheet.

**Tests**

- Mock `window.scrollY` (800) and `window.scrollTo`.
- Enter full screen from the floating button, then exit.
- Assert `window.scrollTo` is called with `(0, 800)` and the exit trigger receives
  `focus({ preventScroll: true })`.
- The test must fail on the old code, which neither saves nor restores the position.

**Done when**

- In a browser at 375px and desktop, entering full screen mid-sheet and exiting by button or
  `Escape` returns to the same reading position.
- Entering from the title bar (scroll at top) still exits at the top.

---

### Task 4 — Pin the app header lookup (optional, comment 7)

**Goal:** adding another `<header>` above the app bar cannot break the floating button.

**Files**

- `src/App.tsx`
- `src/pages/SessionPage.tsx`
- `srcTest/pages/SessionPage.test.tsx`

**Change**

- Add `data-app-header` to the sticky app `<header>` in `src/App.tsx`.
- In the floating-button effect, replace `document.querySelector('header')` with
  `document.querySelector('[data-app-header]')`.
- Leave the `[data-fullscreen-trigger]` lookup as it is.

**Tests**

- Give the test app header `data-app-header`.
- Add a decorative `<header>` before it with a different bottom edge; the floating button must
  still use the app header's bottom. The test fails on the old selector.

**Done when**

- The floating button still appears at the same scroll point in the browser.
- No other `<header>` in the page affects it.

---

### Task 5 — Document what deleting a set does to its lyrics link (comment 5)

**Goal:** the behaviour change is stated plainly.

**Files**

- `README.md`

**Change**

- Add one line under **Before you rely on it**:
  `- **Deleting a set:** its lyrics link stops updating, but it still opens until it expires.`
- Keep the existing line about choosing **Update lyrics** after a failed update.

**Done when**

- The README explains both the automatic update and its two limits: manual retry and deletion.

---

### Task 6 — Deferred: shared rate limit (comment 4)

**Goal:** record the finding without expanding this PR.

**Change**

- No code change in this PR.
- Reply on the PR comment: the limiter counts every endpoint per IP (30/minute, 300/day), and
  lyrics plus set updates can now send two PUTs per edit. The in-memory per-instance counts
  make the risk smaller, but a dedicated budget for publication PUTs is worth a follow-up.
- Open a follow-up issue only if the owner wants one. Do not use `gh` writes in this session.

**Done when**

- The PR conversation records the deferral and the follow-up.

## 5. Appendix — optional visible status warning

Not planned now. Use this if the owner wants visible feedback for offline/rate-limit or 15-song
skips.

- Extract the status map from `liveShareSync.ts` into a small `syncStatus.ts` with
  `set`/`get`/`clear`/`subscribe`, replaying the current status on subscribe.
- Give lyrics its own store, separate from live share.
- Wire `onStatus` and `onSkipped` inside `createLyricsSync`; export
  `subscribeLyricsSyncStatus` and `markLyricsSyncOk`.
- In `ShareLyricsLinkPanel`, show an amber line when the link is published and the status is
  `'failing'`:
  `Not updating. Your latest changes haven't reached people reading this link. Choose **Update lyrics** to see why.`
- Call `markLyricsSyncOk` after a successful manual **Update lyrics**.
- Tests: status store replay/notify/clear; a lyrics skip reports `'failing'`; the panel shows
  and clears the warning.
- This is more code than Task 2 and duplicates the live-share pattern, which is why it is not
  part of the merge fix.

## 6. Checks

Run all of these before calling the work done:

```bash
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

No `functions/src/*Store.ts`, cache or `firestore.rules` change is planned, so
`npm run test:emulator` is not required. If that changes, run it and stop `dev:backend` first.

Browser checks, at 375px and desktop, light and dark:

- Lyrics reader: one GET on open; adding a song refreshes once and shows the existing toast.
- Lyrics share panel: reopening after an offline edit publishes the latest lyrics; no extra PUT
  when nothing changed.
- Full screen: enter mid-sheet and exit with the button and `Escape`; position is restored.

Report anything that could not be checked, with the viewport and theme.

## 7. Follow-ups (not in this plan)

- **15-song limit.** A published set that grows past 15 songs stops auto-updating with no
  signal. Decide whether to show a warning or keep the last complete link. Not part of this
  plan.
- **Revision-based snapshot dedupe.** Return `rev` from `GET /api/lyrics-share/:id`, store the
  last applied revision, and ignore snapshots with the same revision. This also removes
  duplicate refreshes after a reconnect.
- **Publication rate-limit budget.** Give lyrics/set/live PUTs their own per-IP budget, or
  raise the shared limit.
- **Lyrics links on followed sets.** `createLyricsSync` skips sessions with `liveSourceId`, so
  a lyrics link generated from a followed set will not auto-update. The panel copy would still
  say it does. Not raised in the review; mention it in the PR reply or handle separately.

## 8. Commit plan

One commit per task, on the PR branch or a new branch as the owner chooses:

1. `fix(share): ignore the first lyrics snapshot` (merge blocker)
2. `fix(share): retry lyrics updates when sharing resumes`
3. `fix(session): keep reading position after full screen`
4. `fix(session): pin the app header lookup`
5. `docs: note that deleting a set stops lyrics updates`

Before the first commit, ask the owner whether the fixes go on `feat/auto-update-lyrics` or a
new branch. Do not amend the existing commits.
