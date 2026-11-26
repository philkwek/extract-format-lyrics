# Presenter view: lyrics on a church screen

Status: design and technical plan decided, build in progress · 2026-11-26 · issue #80 ·
branch `feat/presenter-view`

Design: https://claude.ai/artifact/DBckauEQv33iryuGek54Hs (Claude Design; private to the
owner). Inspiration: phyto.live's present and output screens.

## Goal

A page that shows the current song's lyrics full screen on a projector or TV. It either follows
the host as they change songs, or someone at the presenter laptop controls it.

## Decisions already made (don't reopen)

### Product and UI

| # | Decision |
| --- | --- |
| D1 | The person sharing is called the **host** everywhere in presenter copy. "For other musicians" under **Share full set** stays. |
| D2 | Entry point: the **Share lyrics** section of the share menu. One card split into two rows, like **Send a copy** / **Share live**: "For individual phones" (existing lyrics link, **Preview**, **Copy link**) and "For group projector/screen" (**Copy presenter link**, **Open presenter window**, note: "Updates when you change songs. Stops if your device sleeps or goes offline."). |
| D3 | The presenter has its own address (`/present/:id`), separate from the live set link. It works on another laptop, or in a new window on the host's own laptop dragged to a second display. |
| D4 | Screens narrower than tablet landscape (~1024px) show only "Open this on a bigger screen". No presenter on phones or portrait tablets. |
| D5 | First open on a laptop asks: **Follow the host** (auto) or **Control it myself** (manual). Remembered on that laptop. Subtitle: "You can always change your choice later." A bordered button changes it: **Switch to manual control** (auto mode's settings popover) and **Switch to auto follow host** (manual console header). |
| D6 | Auto mode: the whole song the host is on, nothing else on screen. Updates when the host changes song. |
| D7 | Manual mode: phyto-style console on the laptop plus a separate output window for the projector. Three columns: the set's songs; the song's sections as cards framed in their section colour; "On screen" preview, display settings, **Fade to black**, **Open output window**. |
| D8 | Manual mode has a **Lyrics view** setting (Whole song / Sections), first row of the console's Display settings. →, Space and a clicker go forward, ← back, Esc fades to black. In whole-song mode they move between songs. |
| D9 | Manual mode still receives set changes (order, lyrics, added songs) live. The song list marks the host's song with a neutral "Host is here" pill and the projected song with the accent "On screen" pill; each song shows its artist. |
| D10 | Long songs: up to 3 columns, then the largest text size that fits. Never cut off, never paged. Sections never split across columns. |
| D11 | Song title top left, small, full contrast. Section labels ("Verse 1", "Chorus") on, same size and contrast as lyrics, bold, on their own line. Each section shows once (no repeats). |
| D12 | Lyrics only. Chords and **Simplified** have no effect on the presenter. |
| D13 | Display settings, saved per laptop: **Text size** (−/+), **Lyrics alignment** (Left / Centre), **Case** (Normal case / All caps), **Theme** (Dark / Light, dark default). **Section positioning** (Top / Centre) appears only in manual mode's **Sections** view. |
| D14 | **Lyrics alignment** defaults: Left when the whole song shows, Centre when one section shows. The setting overrides either default. |
| D15 | Auto mode controls, shown only after the mouse moves, bottom right: a status pill, then a **Settings** button (icon and label) that opens the settings popover with **Fade to black** and **Switch mode**. Never anything over the lyrics. |
| D16 | Status pill states: green "Live: Following host"; amber "Not live: Lost connection" (the presenter's own connection is down; last lyrics stay); neutral "Not live: sharing stopped" (link removed or expired; screen goes black). |
| D17 | Song and section changes crossfade in about 0.3 s; instant under `prefers-reduced-motion`. No setting. |
| D18 | Dropped from v1: the host's page does not show what is on screen. |
| D19 | The presenter's own status pill uses `liveTone.ts` colours (emerald live, amber lost connection, neutral ended). |
| D20 | Manual console only: **Edit song lyrics and titles** sits right-aligned on the song title row. It opens an edit view (section title field and lyrics box per section, **Cancel**, **Save changes**, **Reset to host's version**). Edits are saved on that laptop only and change only what's projected; the host's set is untouched. An edited song shows "Edited on this laptop" in the song list. A local edit wins over later host changes to that song until **Reset to host's version**. |

### Technical

| # | Decision |
| --- | --- |
| T1 | The presenter reads the **lyrics link** publication (`sharedLyrics/{id}`), not the live set. Pages: `/present/:id` and `/present/:id/output`, same id as the phone link, lazy-loaded. The payload already holds lyrics only, with labels, and drops repeated sections. |
| T2 | The host's current song is a `currentEntryId` field on the `sharedLyrics/{id}` root doc, written by `PUT /api/lyrics-share/:id/current` with the same Bearer secret. It writes only that field (no songs, no `rev`), only on an existing, unexpired publication. A full lyrics publish must keep the existing `currentEntryId`. |
| T3 | Phones and the presenter refetch lyrics only when the root doc's `rev` changes. A `currentEntryId`-only change never triggers a full fetch. |
| T4 | The host sends the current song ~400 ms after the set page's open song changes (latest wins), including on page open, only while the set has a lyrics link. The current-song request has its own per-publication rate limit, not the scrape IP limiter. **Copy presenter link** / **Open presenter window** create the lyrics link first if needed. |
| T5 | No host heartbeat in v1. "Lost connection" = the presenter's Firestore listener or network is down. "Sharing stopped" = doc missing or expired. |
| T6 | Lyrics links allow 30 songs (same as `MAX_SET_LINK_SONGS`), up from 15, on client and server. |
| T7 | Console ↔ output window: `BroadcastChannel` named after the link id. The console owns state and sends the full render state (song, section, settings, lyrics with local edits applied). The output asks for state when it opens. Same browser only. |
| T8 | Mode and display settings in `localStorage`. Local lyric edits in IndexedDB (`idb-keyval`), keyed by link id + entryId. |
| T9 | Fitting: a new presenter-only fit hook that measures the real DOM, tries 1–3 columns, searches for the largest font that fits (≤ ~8 passes per run), and reruns only on real inputs (song, settings, debounced resize). Reuses `partitionSections` (`songLayout.ts`) and `nextFontSizeAfterOverflow` (`useFitToScreen.ts`). `useFitToScreen.ts` is not changed. **Text size** sets the maximum; long songs may shrink below it. |
| T10 | A shared `useWakeLock` hook keeps the screen on (Screen Wake Lock API), re-requested on `visibilitychange`, no-op where unsupported. Used by the set page (normal and full screen) and both presenter pages. |
| T11 | Full screen: **Go full screen** button with the corner controls in auto mode and the output window; **F** does the same. |
| T12 | Analytics through `analytics.ts`: presenter opened (mode), mode switched, output window opened. No lyrics or song names. |

## Tasks

One commit each, in order, on `feat/presenter-view`. Each task ends with the full check:
`npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions`.

### Task 1: backend: current song, 30-song lyrics links, refetch on rev only

- Files: `functions/src/sharedLyricsStore.ts`, `functions/src/index.ts`,
  `src/lib/exportLyrics.ts`, `src/lib/lyricsLive.ts`, `src/lib/api.ts`,
  `src/pages/LyricsViewerPage.tsx`, tests in `functions/srcTest/`,
  `functions/srcEmulatorTest/`, `srcTest/lib/`.
- Change: `setCurrent(id, entryId)` on the store (update root only; reject missing/expired;
  entryId is a short safe string); `publish()` carries `currentEntryId` over; route
  `PUT /api/lyrics-share/:id/current` with secret check and its own per-id limit;
  `putLyricsCurrentApi` client; `subscribeSharedLyrics` passes `{ rev, currentEntryId }` and
  the viewer refetches only on a new `rev`; both song caps to 30; any "15" in copy/README.
- Tests: store and route unit tests; emulator test that `setCurrent` changes only
  `currentEntryId` and `publish` keeps it; viewer/listener test that a `currentEntryId`-only
  change doesn't refetch.
- Done when: checks and `npm run test:emulator` pass.

### Task 2: keep the screen awake on the set page

- Files: new `src/lib/useWakeLock.ts`, `src/pages/SessionPage.tsx`, README,
  `srcTest/lib/useWakeLock.test.tsx`.
- Change: T10 hook; enabled while a set is open (normal and full screen). README line: the
  screen stays on while a set is open, on browsers that support it.
- Tests: requests on mount, releases on unmount, re-requests when visible, no-op unsupported.

### Task 3: host side: send current song, split share card

- Files: `src/pages/SessionPage.tsx` (or a small `src/lib/presenterCurrent.ts`),
  `src/components/share/ShareLyricsLinkPanel.tsx`, tests.
- Change: T4 sender; D2 split card with **Copy presenter link** / **Open presenter window**.
- Tests: debounced latest-wins sender, no send without a lyrics link; panel renders both rows.

### Task 4: presenter auto mode

- Files: `src/App.tsx` (lazy routes), new `src/pages/PresenterPage.tsx`,
  `src/components/presenter/*`, `src/lib/presenter*.ts`, tests.
- Change: D4 gate, D5 mode choice, D6/D10/D11 whole-song canvas, T9 fit hook, D13–D17
  settings and pill, T10, T11, T12.
- Tests: state machine (following / lost connection / stopped), settings persistence, fit
  search with faked measurements.

### Task 5: manual console and output window

- Files: `src/components/presenter/*`, `src/pages/PresenterOutputPage.tsx`,
  `src/lib/presenterChannel.ts`, tests.
- Change: D7–D9, D13 section positioning, T7.
- Tests: channel protocol (state request, state push), keyboard navigation.

### Task 6: local lyric edits

- Files: `src/components/presenter/*`, `src/lib/presenterEdits.ts`, tests.
- Change: D20, T8.
- Tests: merge of edits with host lyrics, reset, edits survive host updates.

## Out of scope (first version)

- Chords on the presenter, choosing or detecting a second display.
- Showing on the host's page what is on screen (D18).
- A host heartbeat.
- Font choice, image backgrounds, aspect-ratio settings.

## Notes for the build

- Must not touch the protected song sheet (`SongSheet.tsx`, `songLayout.ts`, `lineSplit.ts`,
  `useFitToScreen.ts`). Importing their exports is fine.
- Use `ui-*` tokens and `src/components/ui/`. The lyrics canvas may use its own black/white.
- Check at 1080p and 4K, light and dark, and that a 375px phone shows the D4 message.
- README: say plainly that the presenter stops following when the host's device sleeps or goes
  offline.

## HUMAN steps

- `firebase deploy` (functions, hosting).
- Try it on a real projector or TV with a second display.
