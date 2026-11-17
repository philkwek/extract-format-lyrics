# Set tray: show the song limit only near it

Status: Draft · 2026-11-17
Delivery: one commit, `fix(ui): show the set limit only when it matters`.

## Problem

The tray heading used to read "Your set · 2 of 30 songs". "X of Y" reads like a goal ("pick 30"), not a
limit. Most sets are 4–8 songs, so the limit is noise for nearly everyone. At 30, **Add to set**
on the result cards is disabled with no reason shown next to it.

The 30 is not a limit on sets in the app. It matches what a set link and a live share can carry
(`SET_LINK_MAX_SONGS`), and more songs can be added inside the set later. The copy must say that, not
claim a set can never hold more.

## Decisions already made

1. The heading shows the count only: `2 songs added` (`1 song added` when singular). The bottom bar's
   toggle button (below `lg`) uses the same text.
2. From 25 songs (`TRAY_MAX_SONGS - LIMIT_HINT_WITHIN`) a muted note shows the space left:
   `You can add 5 more.` / `You can add 1 more.`
3. At 30 the note reads: `Sets made here hold up to 30 songs. Remove one to add another.` It
   replaces today's "A set can hold up to 30 songs here." line. The number in the sentence comes from
   `TRAY_MAX_SONGS`.
4. At 30, the main button (**Add to set**) on cards not in the tray says `Limit reached` and stays
   disabled, so the reason is in words, not just a greyed button. Cards already in the tray keep
   `Added`.
5. The note sits in a status region that is always rendered, so a screen reader hears the text change.
   The region is `role="status"` and is empty below 25. Only the full-state sentence is announced
   politely; the 25–29 hints are not (`aria-live="off"` on that text, or render them outside the
   region), so each add doesn't read out "You can add 4 more".
6. No progress bar, no "2 / 30", no toast.

## Changes

- `src/components/import/SongTray.tsx`
  - `countLabel` becomes `${n} song${n === 1 ? '' : 's'}`.
  - Replace the `items.length >= TRAY_MAX_SONGS` paragraph with the always-rendered status region and
    the copy in decisions 2–3.
  - Named constant next to the component: `LIMIT_HINT_WITHIN = 5`.
- `src/pages/HomePage.tsx` (the `getActionState` near line 316) and `src/pages/SearchPage.tsx` (the
  `getActionState` near line 288)
  - The main action label: `inTray ? 'Added' : tray.isFull ? 'Limit reached' : 'Add to set'`.
  - Both pages, so the two screens read the same.
- `.agents/plans/multi-song-tray.md`: update decision 7 (the cap message) to match.

## Tests

- `srcTest/components/import/SongTray.test.tsx`
  - Update the two `2 of 30 songs` assertions to `2 songs`.
  - 1 song → `1 song`, no limit note.
  - 24 songs → no note. 25 → `You can add 5 more.` 29 → `You can add 1 more.`
  - 30 → the full-state sentence exactly: `Sets made here hold up to 30 songs. Remove one to add another.`
  - The status region exists at 2 songs and is empty.
- `srcTest/pages/SearchPage.test.tsx` and a Home page test: with a full tray, a card not in the tray
  shows a disabled `Limit reached`, and a card already in the tray still shows `Added`.

## Done when

- The heading never shows "of 30".
- The note appears from 25 songs and says how many more fit; at 30 it explains the limit and what to do.
- **Add to set** at 30 reads `Limit reached` on both Home and the navbar search.
- The full check list in AGENTS.md passes.
- Checked in a browser in light and dark mode, at 375px and tablet width, with the tray at 2, 25 and
  30 songs. `Limit reached` fits on a card at 375px next to **View source**. (**Start now** is not shown
  at 30, because the tray is not empty.)
