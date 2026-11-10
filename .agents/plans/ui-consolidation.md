# UI consolidation: one set of colours and controls

Status: Done · 2026-11-10 on branch `refactor/ui-consolidation` (owner decisions in §4)
Scope: application chrome only (`src/components`, `src/pages`, `src/index.css`). The protected
song sheet is out of scope.

## 1. Why

We looked at moving the frontend to Meta's Astryx component library. We decided against it for
now:

- In a test build, ten Astryx components added about 226 KB of gzipped JavaScript. Our whole
  app's main bundle is 194 KB gzipped today.
- It is a 0.x beta with frequent behaviour changes.
- It would remove only about 600–900 lines of our code.

The goals were easier upkeep, one consistent theme, and fewer custom components. This plan
meets them with what we already have: the `--ui-*` colour tokens in `src/index.css` and the
primitives in `src/components/ui/`.

## 2. What exists today

- **Tokens:** `--ui-canvas`, `--ui-surface`, `--ui-surface-raised`, `--ui-surface-muted`,
  `--ui-text`, `--ui-text-muted`, `--ui-border`, `--ui-border-strong`, `--ui-accent`,
  `--ui-accent-strong` and `--ui-focus` are defined under `:root` and `:root.dark`
  (`src/index.css:77-108`). Newer components use them as `bg-[var(--ui-surface)]`.
- **Primitives:** `Button`, `IconButton`, `SegmentedControl`, `Surface`, `StatusBanner`,
  `LivePill` and `Toast` (`src/components/ui/index.tsx`), plus `OverlayDialog`. They are
  styled by the `.ui-*` classes in `src/index.css`.
- **The drift:** older files hard-code colours as light/dark pairs instead of using tokens.
  There are 283 `[#xxxxxx]` hex classes in `.tsx` files:

  | File | Hex classes |
  | --- | --- |
  | `src/components/UploadSheetModal.tsx` | 41 |
  | `src/components/SongSheet.tsx` | 28 (protected, out of scope) |
  | `src/components/ChordKeyboard.tsx` | 22 (out of scope, see §8) |
  | `src/pages/SessionPage.tsx` | 15 |
  | `src/pages/HomePage.tsx` | 8 |
  | `src/components/ChordPositionToolbar.tsx` | 8 |
  | `src/App.tsx` | 5 |
  | `LyricsViewerPage`, `SongHeader` | 4 each |
  | `ShareImportPage` | 3 |
  | `LyricsViewerContent` | 2 |
  | `SearchPage`, `LiveFollowPage`, `ImportProgressList`, `SetLinkImportView`, `PadControls`, `ArrangeDrawer` | 1 each |

  The most common pairs are `bg-[#3368A0] dark:bg-amber-500` (the accent),
  `border-[#C8DFDB] dark:border-[#282828]` (borders) and `dark:text-[#999999]` (muted text).
- **Duplicate logic:** `OverlayDialog` and `ArrangeDrawer` each have their own copy of the same
  code: focus the first control, trap Tab, close on Escape, lock body scroll, restore focus.
- **Raw `<button>`s outside the song sheet:** 33. Most are in `UploadSheetModal` (9). Others are
  deliberate (see §7).

## 3. Expected visual shifts

The owner chose on 2026-11-10 to snap colours to the existing tokens (see §4). These shifts
are expected and accepted:

- Light borders `#C8DFDB` (sage) become `--ui-border`, which renders about `#DBE1E1` on
  white: lighter and less green.
- Dark muted text `#999999` becomes `#a5a5a0`.
- Dark borders `#282828` become `rgba(255,255,255,0.09)`: within a few shades.
- The dark-mode import button goes from emerald with black text to the `success` button
  (green with white text).
- `UploadSheetModal`'s text glyphs (`<`, `>`, `✓`, `✕`) become lucide icons (Task 4).

## 4. Decisions already made (do not reopen)

- No new UI library. Astryx, Radix, MUI and similar are out.
- Hard-coded colours snap to the existing `--ui-*` tokens, accepting the small shifts in §3.
  No legacy tokens that keep the old exact values (owner, 2026-11-10).
- Text glyphs used as icons in `UploadSheetModal` become `lucide-react` icons (owner,
  2026-11-10).
- The protected song sheet (`SongSheet.tsx`, `songLayout.ts`, `lineSplit.ts`,
  `useFitToScreen.ts`, `.font-sheet`, the column CSS) is not touched.
- No change to behaviour, copy or DOM structure beyond what a task names. This is a styling
  and deduplication pass.
- `DisplayControls` keeps its own columns group and font-size stepper. The columns group can
  show no selection when "fit" is on, which `SegmentedControl` does not support, and both
  already use tokens.

## 5. Rules for every task

- Follow AGENTS.md. One commit per task. Ask the owner whether commits go on `main` or a new
  branch before the first commit.
- **Baseline:** 104 test files, 945 tests, all passing.
- After each task run:

  ```bash
  npm test && npm run lint && npm run build
  ```

  These tasks touch no backend files, so `test:functions` and `build:functions` are needed
  only at the end.
- **Visual check:** after Tasks 4, 5 and 6, compare against the Task 0 screenshots at 375px
  and 768px, in light and dark mode. Report any difference that §3 did not predict.

## 6. Tasks

### Task 0: Baseline screenshots (orchestrator, no commit)

Run the dev server and capture these screens at 375px and 768px, in light and dark mode. Save
them in the session scratchpad, not the repo:

- Home with a set
- Search results
- Session page: setlist tabs, display controls, pad menu open, a failed song's
  **Retry extraction** card, chord position toolbar
- Lyrics viewer
- Upload sheet: file step with the API key panel open, then the review step with a chord
  selected
- Edit set, Arrange drawer, share dialogs

### Task 1: Tailwind utilities for the tokens

**File:** `src/index.css`, `docs/THEME.md`

**Change:**

- Add one token, `--ui-on-accent`, for text on the accent colour: `#ffffff` in light,
  `#16120a` in dark. `.dark .ui-button--primary` already hard-codes `#16120a`; switch it to
  the token.
- Map every `--ui-*` colour to a Tailwind colour so files can write `bg-ui-accent` instead of
  a light/dark pair. Use `inline` so the utility reads the variable, which changes with
  `.dark`:

  ```css
  @theme inline {
    --color-ui-canvas: var(--ui-canvas);
    --color-ui-surface: var(--ui-surface);
    --color-ui-surface-raised: var(--ui-surface-raised);
    --color-ui-surface-muted: var(--ui-surface-muted);
    --color-ui-text: var(--ui-text);
    --color-ui-text-muted: var(--ui-text-muted);
    --color-ui-border: var(--ui-border);
    --color-ui-border-strong: var(--ui-border-strong);
    --color-ui-accent: var(--ui-accent);
    --color-ui-accent-strong: var(--ui-accent-strong);
    --color-ui-on-accent: var(--ui-on-accent);
    --color-ui-focus: var(--ui-focus);
  }
  ```

- Update section 2 of `docs/THEME.md`: chrome colours use the `ui-*` utilities, and raw hex
  belongs only in `src/index.css` and the protected song sheet.

**Test:** none. This adds CSS without changing anything visible.

**Done when:**
- The build passes.
- The built CSS contains `.bg-ui-accent` with `var(--ui-accent)`. Check by adding one
  temporary usage and grepping `dist/assets/*.css`, then remove it.
- Nothing visible changes.

### Task 2: One shared modal focus hook

**Files:** new `src/components/ui/useModalFocus.ts`, `src/components/ui/OverlayDialog.tsx`,
`src/components/ArrangeDrawer.tsx`

**Change:** move the shared code into one hook:

```ts
export function useModalFocus(
  isOpen: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): (event: KeyboardEvent<HTMLElement>) => void
```

- On open: save the active element and `body.style.overflow`, set overflow to `hidden`, and
  focus the first focusable element on the next animation frame.
- On close or unmount: cancel the frame, restore overflow, and restore focus.
- The returned handler goes on the panel's `onKeyDown`. Escape calls `stopPropagation()` and
  `onClose()`. Tab wraps between the first and last focusable elements.
- Use one `focusableSelector`: the longer one from `OverlayDialog`.

`ArrangeDrawer` currently closes on Escape through a `window` listener. With the hook it
handles Escape on its panel, like `OverlayDialog`. Focus moves into the panel on open, so
Escape still works. Leave `SessionPage`'s own scroll lock (`SessionPage.tsx:712`) alone: it
belongs to full screen mode.

**Test:** new `srcTest/components/ui/useModalFocus.test.tsx`:
1. Opening focuses the first button and sets body overflow to `hidden`.
2. Closing restores overflow and focus to the element that opened it.
3. Tab on the last element moves to the first; Shift+Tab on the first moves to the last.
4. Escape calls `onClose` once.

`srcTest/components/ArrangeDrawer.test.tsx` and `srcTest/components/ui/ui.test.tsx` must still
pass unchanged.

**Done when:**
- Both components use the hook.
- Neither component contains `focusableSelector` or `body.style.overflow` any more.
- All tests pass.

### Task 3: Form fields use `ui-field`

**Files:** `src/index.css`, `src/components/UploadSheetModal.tsx`,
`src/components/PadControls.tsx`

**Change:**

- Add a size modifier to `.ui-field` for compact fields:
  `.ui-field--sm { min-height: 1.75rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; }`.
  Match the existing `.ui-field` rule's formatting.
- In `UploadSheetModal`, give the number, password and three text inputs `ui-field`, with
  `ui-field--sm` where the current field is small. Delete their hex classes.
- In `PadControls`, give the custom key `<select>` `ui-field ui-field--sm`, keeping
  `font-mono font-bold`.
- Leave the hidden file input, the `PrivacyPage` checkbox and the `ChordKeyboard` input
  alone.

**Test:** none new. Existing tests must pass.

**Done when:**
- None of these fields has a hex class or a hand-written border, background or focus style.
- Focus shows the shared ring in both themes.

### Task 4: `UploadSheetModal` uses the shared buttons and tokens

**File:** `src/components/UploadSheetModal.tsx`

**Change:** this file has 9 raw buttons and 41 hex classes. Replace them as follows:

| Today | Becomes |
| --- | --- |
| Remove-file `✕` (line ~344) | `IconButton` `variant="ghost"`, lucide `X`, label "Remove file" |
| API key panel toggle (line ~378) | Leave as a full-width disclosure button; colours become `text-ui-text-muted hover:text-ui-text` |
| Preview song pills (line ~445) | Leave the structure; colours become tokens (active: `bg-ui-accent text-ui-on-accent`) |
| Chord nudge `<` `>` | `IconButton` `variant="secondary"`, lucide `ChevronLeft` / `ChevronRight`, keep the labels |
| `✓ Confirm` | `Button` `variant="primary" size="sm"`, `icon={<Check size={14} />}`, text "Confirm" |
| `✕` cancel nudge | `IconButton` `variant="ghost"`, lucide `X`, keep the label |
| "← Back to Upload" | `Button` `variant="ghost" size="sm"`, `icon={<ArrowLeft size={14} />}`, text "Back to upload" |
| "Import N Songs to Setlist" | `Button` `variant="success"`, same text |
| Panels with `border-[#C8DFDB] dark:border-[#282828] bg-white dark:bg-[#1a1a1a]` | `border-ui-border bg-ui-surface` |
| Links `text-[#3368A0] dark:text-amber-400` | `text-ui-accent-strong` |
| Muted text `text-neutral-500/600 dark:text-[#999999]` | `text-ui-text-muted` |

**Test:** check every test that queries these controls by role and name. Nudge buttons keep
their `aria-label`s. If "Back to upload" or the import button text changes, update tests that
query it. The import button's text does not change.

**Done when:**
- `grep -c '\[#' src/components/UploadSheetModal.tsx` is 0.
- The only raw `<button>`s left are the API key toggle and the preview pills.
- The visual check matches §3.

### Task 5: `SessionPage` and `ChordPositionToolbar` colours and buttons

**Files:** `src/pages/SessionPage.tsx`, `src/components/ChordPositionToolbar.tsx`

**Change:**

- **Retry extraction** (`SessionPage.tsx:~1605`) becomes `Button` `variant="secondary"
  size="sm"`. It keeps `disabled` and its text.
- Swap the remaining hex pairs in `SessionPage` for `ui-*` utilities. That includes the
  "go home" link at `~1226` (`text-ui-accent-strong underline`) and the live dot
  (`bg-ui-accent`).
- In `ChordPositionToolbar`:
  - Nudge buttons become `IconButton` `variant="secondary"` with lucide chevrons. Check what
    glyph they render now before choosing.
  - **Cancel** becomes `Button variant="ghost" size="sm"`.
  - **Save** becomes `Button variant="primary" size="sm"`.
  - The panel's colours become tokens. Keep `backdrop-blur-md` and the translucent
    background: it is floating chrome.
- Leave the song tab strip (`SessionPage.tsx:1462-1580`) alone, including its remove button.
  It changes in a separate task (§8).

**Test:** existing `SessionPage` tests must pass. Check any test that finds the toolbar
buttons by name; the labels must not change.

**Done when:**
- No hex classes are left in either file outside the tab strip.
- The visual check matches.

### Task 6: Token sweep for the remaining chrome

**Files:** `src/App.tsx`, `src/pages/HomePage.tsx`, `src/pages/LyricsViewerPage.tsx`,
`src/components/SongHeader.tsx`, `src/pages/ShareImportPage.tsx`,
`src/components/LyricsViewerContent.tsx`, `src/pages/SearchPage.tsx`,
`src/pages/LiveFollowPage.tsx`, `src/components/import/ImportProgressList.tsx`,
`src/components/SetLinkImportView.tsx`, `src/components/PadControls.tsx`,
`src/components/ArrangeDrawer.tsx`

**Change:** colour-only. Replace each hex light/dark pair with the matching `ui-*` utility:

| Today | Becomes |
| --- | --- |
| `bg-[#3368A0] dark:bg-amber-500` | `bg-ui-accent` |
| `hover:bg-[#255283] dark:hover:bg-amber-400` | `hover:bg-ui-accent-strong` |
| `text-[#255283] dark:text-amber-400`, `text-[#3368A0] dark:text-amber-400` | `text-ui-accent-strong` |
| `text-white dark:text-[#16120a]` (or `dark:text-black`) on accent | `text-ui-on-accent` |
| `border-[#C8DFDB] dark:border-[#282828]` (or `#2e2e2e`) | `border-ui-border` |
| `text-neutral-800/900 dark:text-[#e5e5e5]` | `text-ui-text` |
| `text-neutral-500/600 dark:text-[#999999]` (or `#777777`) | `text-ui-text-muted` |
| `bg-white dark:bg-[#1a1a1a]` | `bg-ui-surface` |
| `dark:bg-[#101010]` page backgrounds | `bg-ui-canvas` |
| `bg-[var(--ui-x)]`, `text-[var(--ui-x)]` | `bg-ui-x`, `text-ui-x` (only on lines you already touch) |

In `LyricsViewerContent`, change only the active tab's colours. Keep the tab structure and
keyboard handling.

If a pair has no close token, such as `text-[#1c436b]` or `border-[#66A3BF]`, leave it and
list it in the report. Do not invent a new token.

**Test:** none new. All existing tests must pass.

**Done when:**
- `grep -rn '\[#' src --include=*.tsx` lists only `SongSheet.tsx`, `ChordKeyboard.tsx`, the
  `SessionPage` tab strip and the leftovers listed in the report.
- The visual check matches.

### Task 7: Guard against new hex colours, and document the rule

**Files:** new `srcTest/designTokens.test.ts`, `AGENTS.md`, `docs/THEME.md`

**Change:**

- Add a test that reads every `.tsx` file under `src/` with `fs`. It fails if a file contains
  `\[#[0-9a-fA-F]{3,8}\]`, unless the file is in an allowlist. The allowlist holds
  `SongSheet.tsx`, `ChordKeyboard.tsx` and the files with leftovers from Task 6. For
  `SessionPage.tsx`, allow at most the count left in the tab strip.
- Add one line under "Design rules" in AGENTS.md: "Chrome colours use the `ui-*` utilities
  (`bg-ui-accent`, `border-ui-border`). No hex in `.tsx` outside the song sheet."
- Add the same rule to `docs/THEME.md` section 5.

**Test:** the new test itself. Show that it fails by adding `bg-[#123456]` to a file not on
the allowlist, then remove it.

**Done when:**
- The test passes on the finished code.
- It fails on a new hex class.
- The full check list passes:

  ```bash
  npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
  ```

## 7. Raw buttons that stay on purpose

- **`SongSheet.tsx` (9) and `ChordKeyboard.tsx` (8):** protected, or part of the protected
  editing flow.
- **`DisplayControls` columns and font-size buttons:** see §4.
- **`PadControls` pad toggle and menu chevron:** a split button with its own playing state.
- **`TransposeSelector` reset:** a 20px control inside a pill. `IconButton` is 42px.
- **`UploadSheetModal` API key toggle and preview pills:** see Task 4.
- **The `SessionPage` song tab strip, including its remove button:** see §8.

## 8. Follow-ups (not in this plan)

- **One shared song tab strip.** `SessionPage` and `LyricsViewerContent` each build their own
  tab strip with different keyboard handling. Only `SessionPage` uses `getNextTabIndex`. The
  `SessionPage` strip also supports drag, remove and live states. Merging them is
  behaviour work with its own tests.
- **`ChordKeyboard` colours.** It renders inside the song sheet's editing flow, so it needs a
  before/after comparison as its own task.
- **Chord nudging in one place.** `UploadSheetModal` has its own nudge controls that copy
  `ChordPositionToolbar`. Merging them changes keyboard behaviour, because the toolbar listens
  for arrow keys on the whole window.
- **A `Popover` primitive** once a second popover appears. Today only `PadControls` has one.

## 9. Done when

- Tasks 1–7 are committed, one commit each.
- The full check list passes. The test count is at least 945 plus the new tests.
- Hex colours in `.tsx` are limited to the allowlist.
- `OverlayDialog` and `ArrangeDrawer` share one focus hook.
- Screenshots at 375px and 768px, in light and dark mode, show only the shifts §3 predicted.
