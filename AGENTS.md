# AGENTS.md

Rules for any coding agent (Claude, Codex, OpenCode, Cursor) working in this repo. Read this
first. The detailed design system is in [docs/THEME.md](docs/THEME.md).

## What this is

**Sets & Sheets** (setsandsheets.com) is a browser chord-sheet and setlist app for worship
teams and cell groups. People read it on a phone, tablet or laptop while playing, often in a
dim room. Decisions favour **readability while playing**, then stability, then everything else.

- Frontend: React 19, TypeScript, Vite, Tailwind v4, React Router. Songs and sets live in
  IndexedDB (`idb-keyval`).
- Backend: Firebase Cloud Functions (Node 22, TypeScript, Cheerio) in `functions/`. Firestore
  holds shared sets and lyrics links.

## How to make changes

1. **Make the smallest change that fully solves the task.** No drive-by renames, no
   reformatting lines you didn't change, no new dependencies or config files unless the task
   needs them. If you spot something else worth fixing, mention it instead of fixing it.
2. **Match the code around you.** Look at the closest file before you write a new one.
3. **Stop and ask** when the code doesn't match what the task or plan describes, or when a
   fix needs more than the task says. Don't guess.
4. **Don't reopen decisions** recorded in `.agents/plans/*` under "Decisions already made".
5. **Delete instead of keeping dead code.** Prefer one shared helper over three copies (see
   `updateSongItem`, `boundedMap`, `canonicalChartUrl`).

## Code style

- Prettier: `semi: false`, `singleQuote: true`, `trailingComma: all`, `printWidth: 100`.
- Imports: backend (`functions/src`) uses the `.js` suffix (`'./urls.js'`); frontend has none.
- Comments: few. Write one short line only when the *why* isn't obvious from the code.
- Shared UI primitives live in `src/components/ui/` (`OverlayDialog`, buttons, segmented
  controls, banners). Use them before writing a new dialog or button.
- Effects and layout: never let an effect react to its own output. Measuring layout, then
  setting state, then resizing is a feedback loop; bound it or trigger only on real inputs
  (see `useFitToScreen.ts`). Cap caches and audio buffers instead of keeping everything.

## Tests and checks

- Frontend tests: `srcTest/`, mirroring `src/`. Backend tests: `functions/srcTest/`, mirroring
  `functions/src/`.
- A bug fix comes with a test that **fails on the old code**. Check it: stash only the source
  change, run that test, see it fail, restore.
- Before you call anything done, run all of these and fix failures:

```bash
npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions
```

- Changes to `functions/src/*Store.ts`, the caches or `firestore.rules` also need
  `npm run test:emulator` (runs `functions/srcEmulatorTest/` against the Firestore emulator;
  needs Java). Stop `dev:backend` first, since both use port 8080.
- For UI changes, look at the result in a browser in **light and dark mode**, at **phone
  (375px) and tablet widths**. Report anything you could not check.

## Git and safety

- One commit per logical change. Subject: `fix(<area>): <what>`, `feat(<area>): ...`,
  `refactor(<area>): ...`, `chore: ...`, `docs: ...`. Areas in use: `ui`, `session`, `share`,
  `api`, `cache`, `lib`, `functions`. The body says **why**, in a few plain lines.
- **Before your first commit, always ask the owner** whether it goes on `main` or a new
  branch. Don't assume either, even for a one-line fix, and don't carry an earlier answer
  over to a new task. Don't amend others' commits.
- **Never run** `firebase deploy`, `gcloud`, `git push`, or `gh` writes unless the owner asks
  in this session. The Firebase and GitHub CLIs on this machine are logged in to the live
  project. List those steps as **HUMAN** steps in your report.
- **Don't read `.env` files** (`functions/.env` included). Never commit keys.

## Design rules

The full token tables and component patterns are in [docs/THEME.md](docs/THEME.md). The short
version:

- **Two identities, both first-class.** Light: white canvas, sea blue `#3368A0` (hover
  `#255283`), sage borders `#C8DFDB`. Dark: matte charcoal `#101010` / `#1a1a1a`, text
  `#e5e5e5`, amber accent (`amber-400`/`amber-500`). Every new colour must work in both modes.
- **Chrome colours use the `ui-*` utilities** (`bg-ui-accent`, `text-ui-text-muted`,
  `border-ui-border`). Each one already follows dark mode, so it needs no `dark:` pair. No hex
  colours in `.tsx` outside the song sheet; `srcTest/designTokens.test.ts` checks this.
- **Restrained, Apple-inspired chrome** without Apple branding. Clear hierarchy, quiet
  surfaces, one primary action per view.
- **Translucency only for global chrome and overlay backdrops.** Forms, cards and anything
  next to the song use solid surfaces. Never stack materials.
- **Motion:** controls give instant CSS feedback. Interruptible spring motion is only for
  dialogs, drawers and direct manipulation (dragging). Honour `prefers-reduced-motion`,
  `prefers-reduced-transparency` and `prefers-contrast: more`.
- **Accessibility:** status is never shown by colour or icon alone. Icons come from the
  shared set (`lucide-react`). Dialogs trap focus and contain overscroll.
- **Touch first.** Everything must work on a phone and tablet, not just with a mouse.
  Desktop-only gestures (drag to reorder) need a touch path (the Arrange drawer).

### The protected song sheet

The chord-and-lyric canvas is what musicians read mid-song. Don't change its width, padding,
typography, colours, DOM structure, columns, wrapping, overflow detection or editing
behaviour as part of other work. This covers:

- `src/components/SongSheet.tsx`, `src/lib/songLayout.ts`, `src/lib/lineSplit.ts`,
  `src/lib/useFitToScreen.ts`
- `.font-sheet`, the column CSS, section blocks, chord positioning, split/merge controls

A change there is its own task, with a before/after comparison at the same viewport.

## Writing (UI copy, README, commits, reports)

- Plain English for a musician, not a developer. Short sentences. No jargon in the UI.
- Button labels are short verbs: "Share lyrics", "Update lyrics", "Pad". If a label wraps
  on a phone, shorten it.
- Refer to UI controls in **bold** with their exact label.
- Say what a feature can't do as plainly as what it can (see "Before you rely on it" in the
  README).
- Demo content, screenshots and test fixtures use **original demo lyrics**. Never copy real
  song lyrics into the repo.

## Reporting back

End with: what changed (files), what you ran and its result, what you could not verify, and
any HUMAN steps. If a check failed, say so with the output. Don't claim something works if
you didn't see it work.

## graphify (knowledge graph)

The repo has a `graphify` knowledge graph in `graphify-out/` (gitignored, so it only exists on
machines that built it).

- **Use it for big reads:** exploring the repo, architecture questions, or anything that
  would otherwise mean reading many files. Start with `graphify query "<question>"`, then
  `graphify path "<A>" "<B>"` or `graphify explain "<concept>"`. Read
  `graphify-out/GRAPH_REPORT.md` only for a broad architecture review.
- **Skip it for small, targeted work:** if you already know the file, just open it.
- **If `graphify-out/graph.json` is missing** (fresh clone, cloud session), use grep and file
  reads. Don't build the graph just for one task.
- **Update the graph once, at the end.** Run `graphify update .` only after all changes for
  the task are final and the checks pass, not after each edit.

## Where agent files live

| Path | What it is |
| --- | --- |
| `AGENTS.md` (this file) | The one source of rules for every agent |
| `CLAUDE.md` | One line that loads this file into Claude Code, local and cloud |
| `.agents/plans/` | Plans for larger work: tasks with the files, the change, the test and "Done when" |
| `.agents/rules/`, `.agents/workflows/`, `.agents/skills/` | graphify rules and skill for agents that read `.agents/` |
| `.agents/codex-skills/` | Codex's copy of the graphify skill; `.codex/skills` links here |
| `.codex/hooks.json` | Codex hook; has to stay in `.codex/` |

Put new agent guidance in this file, not in a new markdown file somewhere else. The design
reference stays in [docs/THEME.md](docs/THEME.md) because it's for people too.
