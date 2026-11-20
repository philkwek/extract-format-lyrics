# Full screen header: more height for chords

Status: Draft · 2026-11-20
Issue: https://github.com/philkwek/extract-format-lyrics/issues/76
Design: the three "Final" boards of the design canvas
(https://claude.ai/artifact/N9mhRBWswgZeNXFV5RpSum): "Final - Desktop" (`Artboard-6d57`),
"Final · Phone · Light" and "Final · Phone landscape · Light".
Supersedes: `phone-full-screen.md` (bottom bar, More sheet, Pad key sub-page). Those ideas can
come back as their own issues.
Builds on: `full-screen-mode.md` (behaviour, exclusions) and PR #75 (swipe track, `SheetPage`).
Delivery: four commits, one per task below, in order.

## Problem

Full screen spends two rows on chrome: the song tab row, then a row with the song title, status
line and the Key / Simplify / Pad / **Customise** controls. That row takes height the chords
need, most of all on phones.

## Decisions already made

1. **One header row on desktop and tablet.** Song tabs on the left; Key, Simplified, Pad,
   **Customise** and **Exit full screen** on the right. The old name/controls row is removed.
2. **The title block is the first block of the song**, at the top of column 1 (the issue's
   "first in the array"). It is not pinned in the header. Columns 2 to 4 start higher because of
   it. On phones it scrolls with the song.
3. **Title block contents:** title (wraps to two lines at most), then one line with artist,
   capo and details. Missing parts are left out. The fit status line ("Fits the screen · 4
   columns · text size 15") shows on desktop and tablet only. The overflow warning shows on every
   layout.
4. **Three layouts**, chosen by one shared hook and evaluated live:

   | Layout | Query | Header |
   | --- | --- | --- |
   | `phone-portrait` | `(max-width: 639px)` | Two rows, 44px targets. Row 1: tabs + **Exit full screen**. Row 2: Key, Simplified, Pad, **Customise** |
   | `phone-landscape` | `(min-width: 640px) and (max-height: 499px) and (pointer: coarse)` | One compact row, 32px icon buttons |
   | `regular` | everything else | One row as in decision 1; labels collapse to icons below ~1024px wide |

5. **Phone landscape targets are 32px**, as drawn, below the 44px touch rule. Say so in the report.
6. **Unchanged:** the tab row scrolls sideways with the active tab in view; the swipe chevron;
   **Customise** opens a row under the header and starts collapsed; normal (non full screen)
   mode; the full screen exclusions in `full-screen-mode.md` §3.2.
7. **The protected song sheet changes once**, in task 1, to take the title block. Nothing else in
   it changes (no padding, typography, colour, wrapping or editing change).

## Tasks

### 1. `feat(lib)`: song sheet takes a title block (protected files)

- `SongSheet.tsx`, `songLayout.ts` and `useFitToScreen.ts` accept an optional header block that
  is laid out as the first block of column 1. It has no split, merge, drag or edit controls and
  only exists in full screen.
- Fit counts its height (it measures real layout, so no special case if it is a normal block).
- Tests: `srcTest/` for the layout (block is first in column 1, columns balance with it, absent
  when not passed) and for fit (a song that fit before still fits or steps down predictably).
- Before/after comparison at the same viewport (375, 768, 1280), light and dark, with and
  without the block, to show nothing else moved.

### 2. `refactor(lib)`: layout hook

- New `src/lib/useMediaQuery.ts`: `useMediaQuery(query)` with a live `change` listener and a
  `false` fallback without `matchMedia`; `useFullScreenLayout()` returning
  `'phone-portrait' | 'phone-landscape' | 'regular'` from the queries above, exported as
  constants.
- `src/components/ui/useSheetDrag.ts` uses `useMediaQuery` instead of its own `matchMedia`
  state.
- Tests: `srcTest/lib/useMediaQuery.test.tsx` (initial value, live change, missing
  `matchMedia`, the three layouts). Existing `useSheetDrag` tests pass.

### 3. `feat(session)`: one-row header for desktop and tablet

- In `SessionPage.tsx` full screen: remove the name/controls block (`SongHeader` fullscreen
  variant and its status line). Put Key, Simplified, Pad, **Customise** and **Exit full
  screen** in the tab row, left to right after the tabs.
- Build the title block (title, artist, capo, details, fit status, overflow warning) and pass
  it to the sheet from task 1, inside `SheetPage` so swipe and neighbour pre-rendering still
  work.
- Labels collapse to icons below ~1024px; every icon-only button keeps its accessible name.
- Tests: `SessionPage.test.tsx` (no separate name row, controls in the tab row, title block
  present, **Customise** still toggles the display row).

### 4. `feat(session)`: phone upright and landscape

- `phone-portrait`: two header rows as in the "Final · Phone · Light" board; Simplified,
  **Customise** and **Exit full screen** icon-only; no fit status line in the title block.
- `phone-landscape`: one compact row as in the landscape board.
- Tests: `SessionPage.test.tsx` with each layout mocked (rows, icon-only names, no status line).

## Checks

```
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

No `*Store.ts`, cache or `firestore.rules` changes, so no `npm run test:emulator`.
`graphify update .` once at the end.

Browser, light and dark, after each task that changes the screen:

- 375×812 portrait and 844×390 landscape: header rows as in the boards, title block first,
  swipe and **Next song** show no blank page, **Customise** row opens and closes.
- 768×1024 and 1280×800: one header row, labels collapse to icons when narrow, song starts
  higher than before.
- Regression: normal (non full screen) pages and the song sheet in normal mode look unchanged.
- Reduced motion, reduced transparency and high contrast.
- Report anything that could only be checked with simulated touch.

## Done when

- Full screen has no separate name/controls row on any layout.
- The title block is the first block in column 1 (or at the top of the song on phones).
- Desktop and tablet show one header row; phones show the two-row and compact landscape layouts
  from the Final boards.
- Normal mode and the song sheet's look are unchanged.
- All checks pass and the browser checks were done or listed as not done.

## HUMAN

- Choose `main` or a new branch before the first commit.
- Try the result on a real phone (portrait and landscape) before merging.
