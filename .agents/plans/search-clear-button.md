# Search bar: a clear button when there is text

Status: Draft · 2026-11-18 · issue #73
Delivery: one commit, `feat(ui): add a clear button to the search bar`.

## Problem

After a search, the text stays in the search box, so starting over means selecting and deleting it.
There is no clear affordance, and on a phone the box holds a long title.

There is one search input in the app, `src/components/import/SearchForm.tsx`, used in three places:
`HomePage`, `SearchPage`, and `AddSongSearchPanel` inside the edit-set modal. One change covers all
three. Search runs on submit only, so clearing is local text state — no request is affected.

## Decisions already made

1. The clear button exists only in `SearchForm`. Not in the paste-links field, not in any filter field.
2. It is an `X` icon inside the input, on the right edge, vertically centred, with a thumb-sized hit
   area. The input gets right padding so long titles never run under it. No separate "Clear" button
   next to **Search**: that row is tight at 375px.
3. It renders when the field has any text — `query.length > 0`, not `query.trim()`, so a stray space
   can still be cleared.
4. It stays visible and enabled during an in-flight search. Clearing does not cancel the request.
5. Clearing changes the text only. Existing results and the error banner stay on screen. No new
   callback prop, no change to `HomePage` / `SearchPage` / `AddSongSearchPanel`.
6. After clearing, focus goes back into the text input. The button unmounts, so without this a
   keyboard user loses their place.
7. No Escape handler. `AddSongSearchPanel` sits inside `EditSetModal`, where Escape closes the dialog.
8. No animation on show/hide. It is a control, so it gets instant CSS feedback; a spring or
   `AnimatePresence` would also reflow the field while typing.
9. Icon only, 16px `X`, accessible name `Clear search` (pattern and tooltip from `IconButton`), no
   visible label.

## Changes

- `src/components/import/SearchForm.tsx`
  - `useRef<HTMLInputElement>` on the input.
  - Wrap the input in a `relative` flex-1 container; the input keeps `ui-field px-3.5 py-2.5 text-sm`
    and gains `pr-11`. Check the padding actually wins over `px-3.5` (Tailwind emits `pr-*` after
    `px-*`; confirm in the browser, not just in the class string).
  - When `query.length > 0`, render `IconButton label="Clear search" variant="ghost"` holding
    `<X size={16} />`, absolutely positioned to the right, `top-1/2 -translate-y-1/2`:
    `onClick={() => { onQueryChange(''); inputRef.current?.focus() }}`.
  - `Button` already defaults to `type="button"`, so the click cannot submit the form. Keep it that
    way — a submit here would fire an empty search.
- `src/index.css`
  - One rule next to the existing `.song-tray-icon` precedent, since `ui-button--icon` (2.65rem
    square) is as tall as the whole field:
    `.ui-field-clear { width: 2.75rem; height: 100%; border-radius: 0 0.8rem 0.8rem 0; }`
  - Applied through `className="ui-field-clear"` so the ghost hover tint and `focus-visible` ring
    come from the shared button styles. No new colours, no `dark:` pair.
  - The ring is inset (`outline-offset: -3px`): at the shared 2px offset it spills outside the
    field's right edge, because the button spans the field's full height.
- Nothing else. No page changes, no `AddSongSearchPanel` change, no new props.

## Tests

`srcTest/components/import/SearchForm.test.tsx`:

- Empty query → `queryByRole('button', { name: 'Clear search' })` is `null`.
- `query: ' '` and `query: 'Grace'` → the button is present.
- Click it → `onQueryChange` called with `''`.
- After the click, `document.activeElement` is the textbox (focus returns).
- Existing tests stay as they are; the form still submits on Enter and **Search** still disables on
  an empty query.

## Checks

```
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

No `*Store.ts`, cache or `firestore.rules` changes, so `npm run test:emulator` is not needed.
`graphify update .` once at the end, after everything passes.

Browser: light and dark, 375px and tablet. Confirm the `X` sits inside the field in all three
surfaces (home, search page, add-song panel) — the edit-set panel sits on a modal surface with a
different field background.

## Done when

- Typing shows an `X` in the search box; emptying the text hides it.
- Clicking `X` empties the box, keeps focus in it, and leaves results on screen.
- The button is reachable by keyboard, named "Clear search", and works in both colour modes.
- No change to search behaviour, results, or the song sheet.

## HUMAN

- Ask the owner whether this commit goes on `main` or a new branch before committing.
