# Full Screen Mode + Fit to Screen — Implementation Plan

Status: Implemented
Scope: the setlist chord-sheet view (`/session/:sessionId`) only

The shared lyrics view (`/lyrics/:shortId`) is explicitly out of scope and must not change.

## 1. Definition

"Full Screen" here means an **in-browser immersive layout**, not the browser Fullscreen API:

- The site header/navbar and footer are completely hidden.
- The set-management chrome (set name, Share set, Share lyrics, Arrange, Add song, Upload) is hidden.
- The chord sheet uses the full browser viewport.
- The browser's own address bar/tab strip is untouched. We will **not** call `requestFullscreen()`.

The song sheet is the page: it should fill the remaining viewport height below a compact top bar, and the page itself should not scroll when Fit to Screen succeeds.

## 2. Target layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Song 1] [Song 2] [Song 3] ...                         [Exit full]  │  ← tabs row
├──────────────────────────────────────────────────────────────────────┤
│ Song title · artist / capo       [G (Original) ▾] [Pads ▶] [Customise] │  ← name row
│ [Columns 1 2 3 4 | Fit]  [A− 11 A+]                                 │  ← only when open
│ Auto layout · 3 columns · 11px                                      │  ← status
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   chord sheet viewport                                               │
│   (1–4 balanced columns, no page scroll when fit succeeds)            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

On narrow screens the song row may wrap. The fit calculation measures the **actual** remaining height, so wrapped controls are accounted for automatically.

## 3. Behaviour

### 3.1 Entering and leaving

- Normal mode: add a **Full screen** button (maximise icon + label on desktop, icon-only on mobile) to the set title bar action group.
- Full-screen mode: show an **Exit full screen** button in the top bar.
- `Escape` also exits, but only when no dialog/chord keyboard is open.
- Full-screen state is local UI state, not persisted. Refreshing returns to normal mode.
- On exit, restore focus to the button that entered full screen.
- Entering full screen exits chord-editing mode, chord-position mode and split-line mode. Full screen is a performance/playback view; the listed controls do not include editing. All chord/section changes are already persisted as they are made.
- Hide the "Customize sections" tip and set-level modals in full-screen mode. Any modal already open should close before entering.
- If the current song is loading or in an error state, keep the full-screen shell and exit control visible; show the existing loading/error content inside it.

### 3.2 What stays in full screen

Required:

- Song tabs for the set (horizontally scrollable, active tab auto-scrolled into view).
- Song title, artist and capo.
- Transpose selector. The original-key badge is omitted because the selector already marks the original key.
- Simplify toggle beside the transpose selector when the song has simplified chords.
- Ambient pad button.
- Pads Key switch (Match Song / Custom) and custom pad key selector when Custom is active. Pad controls sit on the name row.
- View controls: columns 1/2/3/4, Fit toggle and text size. These are collapsed behind a **Customise** button on the name row and expand as a row below it.
- A compact status line for the fit result or overflow warning.
- Exit full-screen control.

Confirmed exclusions:

- Set name and all set-management actions (Share set, Share lyrics, Arrange, Add song, Upload).
- Edit chords and Restore original. These remain available in normal mode only.
- External source link.
- Per-song remove buttons and drag-reorder affordances. Tabs remain clickable and keyboard-navigable for switching songs.
- The "Customize sections" tip.

### 3.3 Fit to screen

Fit is the default layout in full-screen mode. It aims for:

1. No vertical page scroll: the entire sheet is visible in the sheet viewport.
2. No horizontal text overflow: no lyric/chord line is clipped or pushed off-screen.
3. Readability: keep the user's current text size if possible; add columns before shrinking text.

Proposed candidate order:

```
current columns at current font size
→ if it does not fit, try the other column counts (1–4) at the same font size
→ if none fit, reduce font size by 1px and repeat
→ stop at the minimum readable font size (11px)
→ if still impossible, allow the sheet viewport to scroll and show a compact notice
```

Four columns is now a **first-class manual option** across the board, not only an automatic overflow valve. Fit may also choose 4 columns when it avoids scrolling, but only when that layout passes the horizontal-width check.

The algorithm must not silently violate the user's chosen layout when it already fits: if the current manual column layout (1–4) fits, Fit leaves it alone.

#### Measurement

The existing `useFitToScreen.ts` prototype is unused and calculates against `window.innerHeight - 180`, so it cannot work with a real toolbar. The replacement should:

- Measure the actual sheet viewport (`clientWidth`/`clientHeight`) after the top bar has laid out.
- Use a hidden `10ch` monospace probe to convert the viewport width into character cells at each candidate font size.
- Reuse `getColumnDisplayWidths` + `allocateColumnWidths` to reject a column count whose allocated width is narrower than any column's intrinsic width.
- Estimate vertical height using `getSectionWeight` (line units) × font size × line-height, plus section gaps/padding.
- After applying the chosen layout, verify the real DOM: `sheet.scrollHeight <= viewport.clientHeight` and no line has `scrollWidth > clientWidth + 1`.
- If verification fails, step to the next candidate (down one font size, or try the next column count). Cap the correction passes to avoid layout loops.
- Recompute on window resize, orientation change, browser zoom, font load, song change, section edits, simplified-toggle changes, and full-screen enter/exit.
- Use `ResizeObserver` plus `requestAnimationFrame` coalescing; do not measure on every render.
- Use `100dvh` (and optionally `visualViewport` resize events) for mobile browser chrome. The result is still only in-browser immersive mode.

#### 4th column

- Extend `partitionSections` to support 4 balanced, chronological columns. Prefer a generic dynamic-programming partitioner over the current special-case 2/3-column code; preserve order and minimise the tallest column, then minimise spread.
- Extend `SheetColumns` to `1 | 2 | 3 | 4` for the rendered layout. `ManualColumns` is also `1 | 2 | 3 | 4`, and the column control shows `1 2 3 4` in both normal and full-screen modes.
- Add the 4-column grid variant in `SongSheet.tsx` and verify `visibleColumnPartitions`, adaptive column widths, and empty-column handling.
- Manual 4 columns follows the same responsive widths as 2/3 columns; below the existing `sm` breakpoint the grid still collapses to one column. At multi-column widths, the existing lyric-overflow warning informs the user if columns are too narrow. Fit will not auto-select a 4-column layout that overflows.
- If Fit finds that 4 columns would cause overflow, it falls back to 3 (or the widest valid count) before shrinking text.

#### Failure state

If even 11px at the widest valid column count does not fit:

- Do not clip text.
- Let the sheet viewport scroll vertically (body remains locked).
- Show a short inline message: "Showing the smallest readable text. Scroll to see the rest." with an accessible `role="status"`.
- Keep the fit toggle active/pressed so it is clear why the layout changed.

### 3.4 Manual overrides while Fit is active

Confirmed: changing columns (1–4) or text size while Fit is active turns Fit off for that song and applies the manual value. The **Fit** button remains visible in the view controls so the user can re-enable auto-fit at any time.

This avoids a confusing state where the user changes a control and Fit immediately changes it back. The per-song preference is saved, so the choice survives song changes/reloads. Manual changes made in normal mode do not disable the full-screen fit preference.

### 3.5 Editing and other transient UI

- Full screen is a performance/playback view, so entering it closes chord-editing, split-line and chord-position modes.
- The floating chord-position toolbar and chord keyboard are therefore not present in full-screen mode.
- Simplify is available in both modes. In full screen it sits beside the transpose selector. Toggling it changes the sections used by the sheet, so Fit re-runs immediately.

## 4. Chrome hiding

`AppShell` currently owns the global header, main container and footer. `SessionPage` cannot hide them by itself.

Recommended implementation:

- Add a small `ChromeVisibilityContext` in `src/App.tsx`:
  - `AppShell` owns `chromeHidden` state.
  - The header renders when `!isLyricsView && !chromeHidden`.
  - The footer renders when `!chromeHidden`.
  - `main` gets a full-screen class when hidden (full width, no max-width/padding).
- `SessionPage` consumes the context and sets `chromeHidden = isFullScreen` in an effect; cleanup resets it on unmount/route change.
- Ensure the existing `/lyrics/:shortId` header-hiding rule still works and composes with this state.
- Alternative: a root `data-immersive` attribute plus CSS. The context is preferred because it keeps the layout condition in React and avoids global DOM mutation.

### Scroll lock

- In full-screen mode, lock document scrolling (`html`/`body` overflow hidden, restore previous values on cleanup).
- The sheet viewport is the only scroll container when Fit cannot fit.
- Do not use `position: fixed` body locking unless testing shows it is needed; it can cause scroll-position jumps on iOS.

## 5. State and preferences

`src/lib/songPrefs.ts`:

```ts
export type SheetColumns = 1 | 2 | 3 | 4
export type ManualColumns = 1 | 2 | 3 | 4

export interface SongDisplayPrefs {
  columns: ManualColumns
  fontSizePx: number
  darkMode: boolean
  simplified?: boolean
  /** Full-screen auto layout. Undefined means "on by default in full screen". */
  fitToScreen?: boolean
}
```

- `getDefaultSongPrefs()` keeps manual columns responsive as today, but now permits 4 as a saved/manual value.
- Legacy stored `columns: 'fit'` (from the removed fit mode) should map to `fitToScreen: true` instead of being discarded.
- `saveSongPrefs` continues to be per song.
- Full-screen `isFullScreen` remains session-local state; refreshing always starts in normal mode.
- Effective fit state: `isFullScreen && (prefs.fitToScreen ?? true)`. Fit is never applied in normal mode.
- Changing columns or text size while Fit is active saves `fitToScreen: false` for that song. Pressing Fit saves `fitToScreen: true`.

## 6. Files and responsibilities

| File | Change |
| --- | --- |
| `src/App.tsx` | Chrome visibility context; conditional header/footer; full-width main class. |
| `src/pages/SessionPage.tsx` | `isFullScreen` state; full-screen shell; compact top bar; Escape handler; scroll lock; chrome context wiring; fit state; close edit modes on enter; hide set-level actions/tip. |
| `src/components/SongSheet.tsx` | Accept `1 \| 2 \| 3 \| 4` columns in normal and full-screen modes; 4-column grid; expose measurement refs/callback; ensure overflow reporting covers fit checks. |
| `src/components/DisplayControls.tsx` | 4-column button; Fit toggle; compact/full-screen variant; manual-override behaviour; fit failure notice. |
| `src/components/SongHeader.tsx` | Compact full-screen variant: title + artist + capo, hide source link. |
| `src/lib/songLayout.ts` | `SheetColumns`/`ManualColumns`; generic `partitionSections` for up to 4 columns; fit width/height helpers. |
| `src/lib/useFitToScreen.ts` | Rewrite the unused prototype into a real measurement hook; remove hard-coded viewport offsets; support 4 columns and verification. |
| `src/lib/songPrefs.ts` | `columns: 1 \| 2 \| 3 \| 4`; `fitToScreen` preference; legacy migration. |
| `src/index.css` | Full-screen shell classes; 4-column grid variant; scroll lock/overscroll behaviour if not handled inline. |
| `srcTest/**` | Unit, component and app-shell tests listed below. |
| `README.md` | Optional feature note after implementation. |

## 7. Test plan

### Unit

- `songLayout.test.ts`
  - 4-column partition preserves chronological order.
  - 4 columns balanced by weight; no empty column when sections >= columns.
  - Fewer sections than columns behaves sensibly.
  - Existing 1/2/3 behaviour is unchanged.
  - Width helpers handle 4 columns.
- New fit-layout tests
  - Current layout fits → unchanged.
  - Current layout doesn't fit → tries the other column counts at the same font size.
  - Chooses 4 columns when needed and horizontally valid.
  - Rejects 4 columns when any column overflows horizontally.
  - Shrinks font only after trying valid column counts.
  - Stops at minimum font and reports `fitsOnScreen: false`.
  - Narrow viewport caps columns.
  - Empty/very short songs do not break.
- `songPrefs.test.ts`
  - Manual columns 1–4 round-trip.
  - New `fitToScreen` round-trip.
  - Legacy `columns: 'fit'` migrates to `fitToScreen: true`.
  - Exact default-object assertions updated.

### Component

- `DisplayControls.test.tsx`
  - 4-column button renders in normal and full-screen variants and persists as a manual choice.
  - Fit button renders, toggles, and reflects active state.
  - Selecting 1/2/3/4 while Fit is active disables fit and applies the manual column count.
  - Pressing Fit again after a manual override re-enables auto-fit.
  - A−/A+ behaves correctly in fit and manual modes.
  - Fit failure notice renders when requested.
- New `SessionPage.test.tsx` (mock `sessionStore`, `songCache`, `api`, pad player)
  - Full-screen button enters full-screen layout.
  - Header/footer are hidden while active (via provider/context).
  - Exit button and Escape restore normal mode.
  - Set-management actions are absent in full screen.
  - Tabs and transpose/pad/view controls remain present.
  - Entering full screen exits chord-editing and chord-position modes.
  - Song change while full screen re-runs fit.
- `App.test.tsx`
  - Chrome hidden state hides both header and footer.
  - Navigating away resets chrome visibility.
  - Existing `/lyrics/` header test still passes.
  - `/lyrics/:shortId` layout is unaffected by the full-screen feature.

### Manual QA

- Desktop 1440, laptop 1280, iPad 1024/834/768, phone 390.
- Short song (no fit changes) and long song (3→4 columns and/or font shrink).
- Manual 4-column layout in normal mode and full screen.
- 1, 2, 3, 4 and 5+ sections; very long lyric/chord lines.
- Dark/light mode.
- Browser zoom 80%, 100%, 150%, 200%.
- Chrome, Safari, Firefox; iOS Safari dynamic browser chrome.
- Edit chords, split/merge line, simplify, transpose, pad on/off.
- Resize while in full screen; rotate a tablet; enter/exit repeatedly.
- Song with extraction error and loading state.

## 8. Decisions and assumptions

### Confirmed decisions

1. **Scope:** only the setlist chord sheet (`/session/:sessionId`). The shared lyrics view (`/lyrics/:shortId`) is untouched.
2. **Fit default:** on by default only in full-screen mode. Normal mode keeps the current manual layout.
3. **Fit priority:** keep the user's text size first. Try the other column counts (1–4) at that size, then shrink text if necessary.
4. **Manual override:** changing columns or text size while Fit is active turns Fit off for that song. A visible **Fit** button lets the user re-enable auto-fit.
5. **4th column:** available as a manual view control everywhere, in normal and full-screen modes. It is not limited to Fit.
6. **Full-screen controls:** only the listed controls. Set management, Edit chords, Restore original and the source link are hidden; Simplify stays beside transpose.

### Assumptions for the remaining details

These were the assumptions used during implementation.

7. **Song metadata:** full screen keeps title, artist and capo, but hides the external source link.
8. **Persistence:** full-screen state is session-only (refresh starts normal). The per-song Fit preference and manual columns persist in `localStorage`.
9. **Minimum font size:** Fit stops at 11px. Manual text size can still go down to 10px when Fit is off.
10. **Editing:** entering full screen exits chord-editing, split-line and chord-position modes. There is no editing UI in full screen.
11. **Keyboard:** entry is via the Full screen button; exit is via the Exit button or `Escape`. No extra shortcut.
12. **Mobile:** Fit tries to remove scrolling down to 11px. If it cannot fit, the sheet viewport scrolls with a compact notice; text is never clipped.

## 9. Implementation notes

- **Compact full-screen name row.** The song title/artist/capo sit on the left. Transpose, the optional Simplify toggle, pad controls and the **Customise** button sit on the right. On narrow windows the right group wraps below the title and stays right-aligned; on tablet/desktop widths it shares the name row. The original-key badge is removed in full screen only.
- **Collapsible view controls.** Columns 1–4, Fit and text size are hidden by default behind the Customise button. Opening it renders a compact row below the name row; the status line stays visible in both states. The button uses `aria-expanded` / `aria-controls`.
- **Pad controls are shared.** `PadControls` is reused by the normal-mode `DisplayControls` and by the full-screen name row. The full-screen variant drops the visible "Pads Key:" label and shortens the button to "Play Pad" (with a full accessible label), saving horizontal space.
- **Fourth column is a real manual control** in `DisplayControls` for both normal and full-screen modes. On screens below the existing `sm` breakpoint (640px), the responsive grid still collapses multi-column layouts to one column, matching the existing behaviour of the 2- and 3-column options.
- **Fit measures the live viewport** (`clientWidth`/`clientHeight`) rather than cached dimensions or `window.innerHeight`. The selection runs on a microtask, then verifies the rendered DOM and steps down one font pixel at a time until the sheet fits or reaches the readable minimum. This also avoids throttled `requestAnimationFrame` callbacks in background tabs.
- **Manual overflow remains scrollable.** When Fit is off or cannot fit at the minimum size, the full-screen sheet viewport uses `overflow-auto`, so manually selected narrow columns are not silently clipped.
- **Full-screen section chrome is removed** by not passing the section edit/reorder/delete callbacks to `SongSheet`. This also removes the drag grip, rename pencil and delete button; tabs remain switchable but cannot be reordered or removed.
- **Fit-safe transitions.** Section blocks no longer use `transition-all`; animating `font-size` during a fit change caused the verification pass to observe transient overflow. The narrower transition keeps hover/drag feedback without affecting text metrics.
- **Focus handling.** Entering full screen records the triggering button; exiting through the button or `Escape` restores focus to it. Escape is ignored while a dialog, input, select or textarea is focused.
- **Tests added:** `srcTest/lib/useFitToScreen.test.ts`, `srcTest/pages/SessionPage.test.tsx`, plus updates to `songLayout`, `songPrefs`, `DisplayControls` and `App` tests.
