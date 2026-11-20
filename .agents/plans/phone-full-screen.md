# Full screen on phones: reading mode

Status: Superseded by `full-screen-header.md` (issue #76, 2026-11-20)
Design: the "Phone · Reading mode" page of the design canvas
(https://claude.ai/artifact/N9mhRBWswgZeNXFV5RpSum): boards A (bottom bar, light and dark),
A scrolled, More sheet, More › Pad key, B landscape (light and dark).
Builds on: `full-screen-mode.md` (full screen behaviour, exclusions) and PR #75 (swipe track,
`SheetPage`, fit rules, 44px touch targets).
Delivery: six commits, one per task below, in order.

## Problem

On a phone, full screen keeps the tablet layout: a row of song tabs, then the title, then a
wrapped block of Key, Simplify, pads and **Customise**. The song starts a third of the way down
the screen, the controls sit at the top where a thumb cannot reach them, and Fit screen shrinks
long songs to 11px ("Smallest readable text applied") to squeeze them onto a screen that is too
small to show a whole song anyway.

## Decisions already made

1. **Reading while playing comes first** on phones (grill Q2). Showing the whole song at once is
   not crucial on a phone; workarounds are fine (owner, grill Q2).
2. **Two layouts only:** A, top bar + bottom bar, for portrait; B, one top row with Fit
   screen, for landscape (grill Q15). No pinch overview, no chord overview.
3. **Bottom bar within thumb reach** holds previous song, Key, Pad, More and next song. It hides
   while scrolling down and comes back when scrolling up (grill Q16).
4. **Swipe stays full screen only** (grill Q11) and keeps working as built in PR #75.
5. **Pad key picker** is a single-column list of the 12 pad keys in `PAD_KEYS` order (C, Db, D,
   Eb, E, F, Gb, G, Ab, A, Bb, B): no offset numbers, no extra sharp spellings (owner,
   2026-11-20). The song's key row carries a "Song key" label. It sits on a sub-page of the More
   sheet, not a new modal. The 17 spellings with "(Orig)/(+2)" offsets belong to the Key
   (transpose) selector only.
6. **Full screen exclusions stand** (`full-screen-mode.md` §3.2): no **Edit chords**, no set
   actions (Add song, Arrange, Share), no section edit controls. The More sheet board shows
   them; the owner confirmed on 2026-11-20 that phone full screen leaves them out too.
7. **The protected song sheet does not change.** No edits to `SongSheet.tsx`, `songLayout.ts`,
   `lineSplit.ts` or `useFitToScreen.ts`.
8. Tablet and desktop full screen stay exactly as they are.
9. **No section strip** (owner, 2026-11-20). The canvas boards showed a row of section chips
   under the title; it is dropped. Reading is by scrolling, swiping and the bottom bar.
10. **No `viewport-fit=cover`** (owner, 2026-11-20). It would change every page; the bottom bar
   pads with `env(safe-area-inset-bottom)`, which stays 0 and harmless without it.

## Which layout applies

One shared hook decides, evaluated live (rotation switches layout without leaving full screen):

| Layout | Media query | Where |
| --- | --- | --- |
| `phone-portrait` (A) | `(max-width: 639px)` | Phones held upright |
| `phone-landscape` (B) | `(min-width: 640px) and (max-height: 499px) and (pointer: coarse)` | Phones turned sideways |
| `regular` | everything else | Tablets, laptops: today's full screen |

The landscape row needs the height test: an 844×390 phone is wider than 640px and would
otherwise get the tablet layout. 499px keeps iPads (≥ 744px tall) and small laptop windows out.

## Tasks

### 1. `refactor(lib)`: shared media-query hook

- New `src/lib/useMediaQuery.ts`: `useMediaQuery(query: string): boolean` with a live `change`
  listener and a safe fallback (`false`) when `matchMedia` is missing. Plus
  `useFullScreenLayout(): 'phone-portrait' | 'phone-landscape' | 'regular'` built on it with the
  queries above, exported as constants so tests and CSS comments share them.
- `src/components/ui/useSheetDrag.ts` uses `useMediaQuery('(max-width: 639px)')` instead of its
  own `matchMedia` state (one helper, not two copies).
- Tests: `srcTest/lib/useMediaQuery.test.tsx` (initial value, live change, missing
  `matchMedia`, the three layouts). `useSheetDrag` tests keep passing.

### 2. `feat(session)`: phone portrait shell (layout A)

In `SessionPage`, when `isFullScreen` and the layout is `phone-portrait`, render a new header and
bottom bar instead of the song tab row and the tablet name/controls block. The swipe track
(`SongSwipe` + `SheetPage`) sits between them unchanged.

- New `src/components/fullscreen/PhoneTopBar.tsx`:
  - Left: `IconButton` **Exit full screen** (‹ chevron, 44px) → `handleExitFullScreen`.
  - Middle: one muted line "{set name} · Song {n} of {N}", then the song title (18px, bold,
    one line, ellipsis). Artist is dropped here to save a row.
  - Right: nothing in v1 (the board's "Go full screen" icon is not needed inside full screen).
  - Translucent global chrome is allowed here (AGENTS: translucency for global chrome). Honour
    `prefers-reduced-transparency` with a solid `bg-ui-canvas`.
- New `src/components/fullscreen/PhoneSongBar.tsx` (the bottom bar):
  - **Previous song** icon button (disabled on the first song).
  - Key: the existing `TransposeSelector` (compact) so the 17 spellings and "(Orig)/(+2)"
    labels match desktop.
  - **Pad**: plays/stops the pad (`handleTogglePad`), label "Pad", pressed style while playing,
    spinner while loading. The pad-key menu moves into the More sheet (task 3).
  - **More** icon button, accessible name "Open song settings" → opens the sheet (task 3).
  - **Next song** button filling the rest of the row: small "Next" over the next song's title,
    chevron right; solid accent (the view's one primary action). On the last song it becomes a
    disabled "Last song" state rather than disappearing, so the bar does not reflow.
  - Bottom padding `max(0.5rem, env(safe-area-inset-bottom))`. Do not add `viewport-fit=cover`
    to `index.html` (decision 10).
- `SongSwipe`: hide the edge chevrons and the first-run hint pill in `phone-portrait`; the bar
  has previous/next and the chevrons sit on top of lyrics at 375px. Swiping stays on.
- Scroll container: the active `SheetPage` keeps scrolling the sheet; the top bar and bottom bar
  are outside it (no page scroll, `100dvh` shell as today).
- Tests: `srcTest/components/fullscreen/PhoneTopBar.test.tsx` and `PhoneSongBar.test.tsx`
  (labels, disabled states, callbacks, last-song state). `SessionPage.test.tsx`: in full screen
  with `phone-portrait` mocked, the song tabs and **Customise** are not rendered, the bar is, and
  **Next song** moves to the next song.

### 3. `feat(session)`: song settings sheet with Pad key picker

- New `src/components/fullscreen/SongSettingsSheet.tsx`, built on `OverlayDialog` (so it gets
  the phone grab handle, drag to close, focus trap and solid surface from PR #75). Title "Song
  settings", last button **Close**.
- Page 1, group **Display**:
  - **Text size** (A− / value / A+). Changing it while Fit is on turns Fit off for that song
    (existing rule, `full-screen-mode.md` §3.4).
  - **Fit screen** switch (`Switch` primitive), with the current fit caption underneath when on.
  - **Wrap long lines** switch.
  - **Simple chords** switch, only when the song has simplified chords; the algorithmic warning
    text from today's **Simplify** title moves into the row's description.
  - **Columns** (1–4 segmented) only in `phone-landscape`; portrait is always one column.
- Page 1, group **Pad**: one row "Choose pad key" with the current value ("Match song (G)" or
  "D") → page 2.
- Page 2, "Pad key" (back link "Settings" returns to page 1, keeps focus on the row it came
  from):
  - Segmented control **Match song / Choose a key** (today's `padKeyMode`).
  - One line: "The song is in G. The pad will play in D until you switch back to Match song."
  - Radio list, one column, 12 rows from `PAD_KEYS` (the same values the desktop custom pad key
    select offers): key name only, checkmark on the chosen row, "Song key" label on the row for
    `resolvePadKey(currentKey)`. Choosing a row sets custom mode and saves that `PadKey` through
    the existing `onSelectCustomPadKey`, so storage is unchanged. While **Match song** is on,
    rows are not selectable.
  - **Play pad in D** / **Stop pad** button at the bottom to preview.
- Sub-page motion: slide between pages with `uiSpring`, cross-fade under reduced motion. No
  second modal.
- `PadControls` keeps its desktop popover; only the phone path uses the new list.
- Tests: `srcTest/components/fullscreen/SongSettingsSheet.test.tsx`: Fit/Wrap/Simple chords
  switches call `onChangePrefs` correctly; text size change turns Fit off; Columns only in
  landscape; Pad key page lists the 12 pad keys in `PAD_KEYS` order with no numbers and no
  sharps, marks G "Song key" for a song in G, and choosing D calls `onSelectCustomPadKey('D')`;
  back returns to page 1.

### 4. `feat(session)`: hide the bottom bar while scrolling down

- New `src/lib/useHideOnScroll.ts`: given the scroll element, returns `hidden: boolean`.
  Hide after scrolling down more than 8px; show on any upward scroll, at the top, and at the
  bottom of the song. Never hide while a dialog is open, while focus is inside the bar, or while
  a pad is loading. Listen to `scroll` with `{ passive: true }`; no state change unless the value
  flips (no feedback loop).
- `PhoneSongBar` slides down off screen (transform only, CSS transition ~200ms) when hidden;
  under reduced motion it fades instead. While hidden the top bar collapses to one line (title ·
  "n of N"), as on the "A · Scrolling down" board.
- Swiping to another song shows the bar again.
- Tests: `srcTest/lib/useHideOnScroll.test.ts` with a fake scroll element: down hides, up shows,
  top and bottom show, small jitters do nothing, open dialog keeps it shown.

### 5. `feat(session)`: phone landscape row (layout B)

- In `phone-landscape`, full screen shows one top row instead of the tablet header: **Exit full
  screen**, title with "· Song n of N · {fit caption}", then **Previous song**, Key, **Pad**,
  **More**, **Next song** (title in the button). No song tabs, no bottom bar.
- Fit screen stays on by default here; with the fit rules from PR #75 most songs land on 2–3
  columns without scrolling (board B).
- Reuses `PhoneSongBar`'s buttons in a `layout="row"` variant rather than a third component.
- Tests: `SessionPage.test.tsx` with `phone-landscape` mocked: one row, no tabs, no bottom bar.

### 6. `feat(session)`: Fit screen off by default in phone portrait

- `fitEnabled = isFullScreen && (prefs.fitToScreen ?? layout !== 'phone-portrait')`. A saved
  per-song choice still wins (prefs are per device), so someone who turns Fit on keeps it.
- Portrait then uses the person's own text size and scrolls.
- Tests: `SessionPage.test.tsx`: with no saved preference, portrait full screen renders at the
  saved text size and Fit off; landscape renders with Fit on; a saved `fitToScreen: true` wins.

## Copy (UI strings)

Sentence case, verbs first, short: **Exit full screen**, **Previous song**, **Next song**,
**Pad** / **Stop pad**, "Open song settings" (accessible name of More), "Song settings",
**Text size**, **Fit screen**, **Wrap long lines**, **Simple chords**, "Choose pad key",
**Match song**, **Choose a key**, **Play pad in D**, **Close**. Status is never colour alone: the
chosen pad key has a checkmark and `aria-checked`, a playing pad says **Stop pad**.

## Checks

```
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

No `*Store.ts`, cache or `firestore.rules` changes, so no `npm run test:emulator`.
`graphify update .` once at the end.

Browser, light and dark, after each task that changes the screen:

- 375×812 and 390×844 portrait: song starts in the top quarter; bar reachable; bar hides on scroll down and returns on scroll up; swipe and **Next song** both
  change song with no blank page; settings sheet drags closed; Pad key list scrolls and selects.
- 844×390 landscape: one row, Fit picks 2–3 columns, no bottom bar; rotate portrait ↔
  landscape without leaving full screen.
- Regression: 768×1024 tablet and 1280×800 desktop full screen look exactly as before; the
  normal (non full screen) phone page is unchanged.
- Reduced motion, reduced transparency and high contrast on the phone layouts.
- Report anything that could only be checked with simulated touch.

## Done when

- On a phone held upright, full screen shows set name and song title at the top,
  the song below, and previous / Key / Pad / More / next in a bottom bar that hides while
  reading down and returns on scroll up.
- More opens a sheet with text size, Fit screen, Wrap long lines, Simple chords and a Pad key
  page listing the 12 pad keys in one column, matching the canvas except for the exclusions in
  decision 6 (no Edit chords, no set actions).
- Turned sideways, full screen is one control row and the song fits in 2–3 columns.
- Tablet and desktop full screen, the normal set page and the song sheet are unchanged.
- All checks pass and the browser checks above were done or listed as not done.

## HUMAN

- Ask the owner whether this work goes on `main` or a new branch before the first commit.
- Try the result on a real phone (portrait and landscape) before merging; simulated touch does
  not show swipe and scroll feel.
