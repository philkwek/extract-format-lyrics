# Presenter view: handoff

Written 2026-11-26. Branch `feat/presenter-view` (from `main` at `0d882d8`), 11 commits, nothing
pushed. Read [presenter-view.md](presenter-view.md) first: its decisions (D1–D20, T1–T12) are
settled and the task list there is the original plan.

## Where it stands

| Task | State | Commits |
| --- | --- | --- |
| Plan | Done | `3c4bd83`, `4e523cf` |
| 1. Backend: current song, 30-song lyrics links, phones refetch only on a new `rev` | Done | `7afe7b5`, `837b878` (GET also returns `currentEntryId`) |
| 2. Keep the screen awake on the set page | Done | `f325045` |
| 3. Host side: send current song, split share card | Done | `6735125` |
| 4. Presenter auto mode | Done | `ebeeb7a` (feed, settings, fit), `65edcef` (page), `ecbbd78` (sizes) |
| Extra: artist on lyrics links (for the console song list) | Done | `0388663` |
| 5. Manual console and output window | Done | `008d688` |
| **6. Local lyric and title edits (D20)** | **Not started** | |
| **Final checks and report** | **Not started** | |

At `008d688`: `npm test` (1,339), `npm run test:functions` (499), lint, `npm run build` and
`npm run build:functions` all pass. `npm run test:emulator` last passed at `7afe7b5` (26/26); it
has not been re-run since `837b878` and `0388663` changed `sharedLyricsStore.ts`.

`.gitignore` has an uncommitted change that predates this work. Leave it alone.

## Task 6: local lyric and title edits

Design: frame "7d Manual console - Edit lyrics and titles (dark)" and note n8 in the
[design artifact](https://claude.ai/artifact/DBckauEQv33iryuGek54Hs). Decision D20 and T8.

**Behaviour**

- Manual console only. A secondary button **Edit song lyrics and titles** (lucide `Pencil`) sits
  right-aligned on the song title row of the middle column, in both Lyrics views. The row
  already exists in `src/components/presenter/PresenterSections.tsx`; its right side was left
  empty for this.
- Editing replaces the middle column for the song being edited:
  - Title row: "Editing: {title}" with **Cancel** (secondary) and **Save changes** (primary, the
    view's one primary action).
  - Info bar under it: "These changes are saved on this laptop only and change what the projector
    shows. The host's set stays the same." with **Reset to host's version**, shown only when the
    song already has a saved edit.
  - A 3-column grid of section cards (scrolls if it overflows). Each card: label "Section title" +
    text input, label "Lyrics" + textarea (`rows={6}`, 16px/24px). Card border and tint from
    `sectionTone(label)` in `src/lib/presenterSections.ts`. A card whose title or lyrics differ
    from the host's gets a neutral "Edited" tag and an accent border.
  - Sections can be renamed and their lines changed; sections are not added, removed or
    reordered.
- Save: store the edit; if it ends up identical to the host's version, delete it instead. Cancel
  discards. Reset to host's version deletes the stored edit and leaves the editor.
- The song list shows "Edited on this laptop" (muted, small) under the artist of every edited song
  (`src/components/presenter/PresenterSongList.tsx`).
- While editing, the song list, section cards in the preview logic, the display panel, **Fade to
  black** and the output keep working; the projector keeps running. The editor stays on its song
  even if another song is projected. Arrow/Space/PageUp/PageDown/Esc shortcuts are off while the
  editor is open.
- Edits win over later host changes to that song until reset. If the host's song disappears from
  the set, its edit is simply unused (keep it; don't garbage-collect in v1).
- What is projected (console preview and output window via `OutputState`) always uses the edited
  version.

**Storage and code**

- New `src/lib/presenterEdits.ts`:
  - IndexedDB via `idb-keyval` (already a dependency; see `src/lib/lyricsPublishIdentity.ts` for
    the pattern), key `presenter-edits:${publicationId}`, value
    `Record<entryId, { sections: { label: string; lines: string[] }[]; editedAt: number }>`.
  - Pure `applyPresenterEdits(lyrics: SharedLyricsPayload, edits): SharedLyricsPayload`, pure
    `isSectionEdited(host, edited)`, and a hook `usePresenterEdits(id)` returning
    `{ edits, saveEdit(entryId, sections), resetEdit(entryId), isEdited(entryId) }`.
  - Textarea text becomes lines by splitting on `\n`, trimming trailing blank lines only.
- `PresenterConsole.tsx`: run `feed.lyrics` through `applyPresenterEdits` before anything else
  uses the songs, so navigation, preview and `OutputState` all get the edited version.

**Tests** (`srcTest/lib/presenterEdits.test.ts`, extend
`srcTest/components/presenter/PresenterConsole.test.tsx`): apply/merge, identical edit is deleted
on save, reset, an edit survives a host update to the same song, edited song shows the "Edited on
this laptop" line, the projected output state carries the edited lyrics, shortcuts are off while
editing.

## Final checks (after Task 6)

1. Full check: `npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions`.
2. Stop any running backend, then `npm run test:emulator`.
3. Browser pass against the local emulators (see "How to run it locally"):
   - Edit flow in the console at 1920×1080; the output tab shows the edited lyrics.
   - Share card in **dark mode** and at **375px** (not checked yet).
   - Console in dark app theme (only light was checked).
   - Auto mode at 4K (3840×2160) to see the fit scale up.
4. Update the plan's status line, then `graphify update .` if `graphify-out/` exists.
5. Report to the owner, then ask before opening a PR (`git push` and `gh` writes need the owner's
   go-ahead in that session).

## How to run it locally

- `.claude/launch.json` only has a `web` config. For checks, temporarily add
  `{"name":"all","runtimeExecutable":"npm","runtimeArgs":["run","dev:all"],"port":5173}`, start it
  with the preview tool, and `git checkout .claude/launch.json` afterwards. `dev:all` runs the
  Functions and Firestore emulators on the `demo-chords` project; nothing touches the live project.
- There's no `.env.local` with the emulator Firestore lines, so the presenter uses its 30-second
  polling fallback locally. Song changes take up to 30 s to show. That is expected.
- Demo data without touching any chord site: in the page, `await import('/src/lib/lyricsPublishIdentity.ts')`
  for `generateUpdateSecret` and `deriveLyricsPublicationId`, then `/src/lib/api.ts` for
  `putSharedLyricsApi` and `putLyricsCurrentApi`. A set can be seeded with `sessionStore.createSession`
  and `songCache.saveSong`. Use original demo lyrics only (the design's "Morning Light",
  "Gathered Here", "Through the Valley" are fine).
- The pane blocks pop-ups, so open `/present/:id/output` in a second tab; the console and output
  still talk over `BroadcastChannel`.
- Presenter localStorage keys: `presenter.mode`, `presenter.display`.

## Things that will bite you

- **OpenCode workers' sandbox has no `functions/node_modules`.** `npm test` and anything matching
  `functions/srcTest` fail there with "Cannot find package 'cheerio'". Give workers checks
  scoped to frontend folders, e.g.
  `--check "npx vitest run srcTest/lib srcTest/components srcTest/pages"` and
  `--check "npm run lint"`. `npx vitest run srcTest` does **not** work: the filter also matches
  `functions/srcTest`. Then land the job and run the full check in the repo yourself.
- **Two workers started at the same moment** collided on `.git/index.lock`. Stagger launches.
- **`erasableSyntaxOnly`** is on: no TypeScript parameter properties (`constructor(public x)`),
  including in tests. `npm run lint` misses it; `npx tsc -b` catches it.
- The frontend `tsc -b` also type-checks files under `functions/src` that the frontend imports, so
  don't import `functions/src/setLinkStore.ts` from `sharedLyricsStore.ts`.
- Prettier is not clean on `functions/src` at `main` already; don't reformat those files.
- Theme: in auto mode and the output window, `PresenterPage`/`PresenterOutputPage` toggle the
  `dark` class on `<html>` from the presenter's Theme setting and restore it on unmount. The
  manual console keeps the app's own theme. Keep it that way.
- `useFitToScreen.ts`, `SongSheet.tsx`, `songLayout.ts`, `lineSplit.ts` are protected; the
  presenter only imports `partitionSections` and `nextFontSizeAfterOverflow`.

## Known limits and follow-ups (not blockers)

- No host heartbeat: if the host's device sleeps, the presenter still says "Live: Following host"
  but stops changing songs. The share card note says so; README should say it too (plan: "Notes
  for the build"). Not yet added to the README.
- Legacy set entries without an `entryId` use `song.id` as the current-song id; ids that fail the
  server's `isCurrentEntryId` check (64 chars, `[A-Za-z0-9_:.-]`) are silently not sent.
- If two output windows are open and one closes, the console shows "Output window: not open yet"
  until the other sends `hello` again (on reload).
- Design frame "9 Host view - On screen line" was dropped from v1 (D18); the artifact still shows it.

## HUMAN steps

- `firebase deploy` (functions and hosting) once merged.
- Try it on a real projector or TV with a second display, and with a presentation clicker.
