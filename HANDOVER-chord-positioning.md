# Handover: Chord Position Editing (Upload Preview → Setlist)

How the "nudge chord left/right" feature works in the upload review modal, and exactly how to port it into the setlist's edit-chords mode.

---

## 1. Data model (why this is simple)

```ts
ChordPlacement { pos: number; chord: string }          // pos = char offset into line.text
Line = { kind: 'lyric'; text: string; chords: ChordPlacement[] } | { kind: 'chords-only'; ... } | { kind: 'tab'; ... }
```

- A chord's horizontal position is **only** `pos` (an index into `line.text`).
- **Moving a chord = changing `pos` by ±1.** Nothing else changes.
- `pos` is **independent of key**. Transposing (`src/lib/transpose.ts`) only rewrites `chord` text, never `pos`. So, unlike chord *text* edits, **position edits need no transpose back-mapping**.
- Only `kind: 'lyric'` lines have positions. `chords-only` and `tab` lines are not nudgeable.

## 2. How the renderer uses `pos`

`renderLyricSegments()` in `src/components/SongSheet.tsx`:

1. Sorts chords by `pos` (stable on original array index).
2. Slices `text` at each chord's `pos` into segments: `text.slice(pos_i, pos_{i+1})`.
3. Renders each segment as an `inline-flex flex-col` column: chord on top, its lyric slice below.

Consequences:
- A chord always travels with the text under it, so it can't drift.
- The chord's **array index (`chordIndex`) never changes** when `pos` changes, even if the visual order changes. This is how selection/edit/delete stay addressable. **Do not re-sort or re-index `chords` when nudging.**
- If a chord is wider than its slice, the column widens. In that case a ±1 nudge may show no visible change until the slice outgrows the chord. Expected.

## 3. Pure helpers: `src/lib/chordNudge.ts` (already written + tested)

```ts
getChordPos(sections, s, l, c): number | null        // null if not a lyric-line chord
setChordPos(sections, s, l, c, pos): Section[]       // clamps to [0, text.length], immutable
nudgeChord(sections, s, l, c, delta): Section[]      // = setChordPos(current + delta)
```

- All immutable (return new `Section[]`), line-kind-safe, clamped to the line.
- Tests: `src/lib/chordNudge.test.ts`.
- **Reuse these as-is in the setlist.**

## 4. UI state machine (upload modal reference: `src/components/UploadSheetModal.tsx`)

```
state: selectedChord = { songIndex, sectionIndex, lineIndex, chordIndex, startPos } | null

tap chord        -> selectedChord = { ..., startPos: getChordPos(...) }   (ignored if already selected / not lyric)
tap another      -> implicit confirm of previous, select new
"<" / ">"        -> sections = nudgeChord(sections, s, l, c, -1 | +1)     (applied LIVE)
"✓ Confirm"      -> selectedChord = null                                  (keep current pos)
"✕ Cancel"       -> sections = setChordPos(..., startPos); selectedChord = null
```

Design choices to keep:
- **Live apply + restore on cancel** (store `startPos`), instead of a draft copy. Cheap and the preview updates instantly.
- **Selection is keyed by indices**, not object identity, which is why the array index must be stable.

`SongSheet` props that drive it (already added, optional, no behaviour change when omitted):

```ts
onChordSelect?: (sectionIndex, lineIndex, chordIndex) => void   // when set, tapping a LYRIC chord selects instead of opening ChordKeyboard
selectedChord?: { sectionIndex, lineIndex, chordIndex } | null  // renders the chord highlighted
```

Note: in `SongSheet`, `onChordSelect` takes precedence over `isEditingChords`/`onEditChord`, and applies to lyric lines only (chords-only lines fall back to `undefined`).

## 5. Porting to the setlist (`src/pages/SessionPage.tsx`)

Today: `isEditingChords` toggle → tapping a chord opens `ChordKeyboard` → `handleEditChord` / `handleDeleteChord` persist to the session.

### Recommended UX
Keep one edit mode, but let a tapped chord offer **both** actions: change the chord text (existing keyboard) **and** move it. Two reasonable options:

- **A. Add Move controls to the existing `ChordKeyboard` modal** (`<` `>` + Confirm/Cancel inline). No `onChordSelect` needed; reuse the existing `editingChord` target in `SongSheet`.
- **B. Toolbar below the sheet** (same as upload modal): in edit mode, tapping a chord *selects* it (`onChordSelect`), toolbar shows `<` `>` ✓ ✕, plus an "Edit chord" button that opens the keyboard.

B mirrors the upload flow exactly; A is less UI. Pick one; steps below apply to both.

### Persistence: copy the `handleEditChord` pattern (lines ~434–499)

Add `handleMoveChord(sectionIndex, lineIndex, chordIndex, newPos)` alongside it. The only differences from `handleEditChord`:

| | `handleEditChord` | `handleMoveChord` |
|---|---|---|
| Mutates | `chord` text | `pos` |
| Transpose back-mapping to original key | **required** | **not needed** (pos is key-independent) |
| Applies to | lyric + chords-only | lyric only |

Skeleton:

```ts
const handleMoveChord = async (s: number, l: number, c: number, newPos: number) => {
  if (!currentSong || !session) return
  const source = isSimplified && currentSong.simplifiedSections ? currentSong.simplifiedSections : currentSong.sections
  const baseSections = setChordPos(source, s, l, c, newPos)          // from chordNudge.ts

  const updatedSong: Song = isSimplified && currentSong.simplifiedSections
    ? { ...currentSong, simplifiedSections: baseSections }
    : { ...currentSong, sections: baseSections }
  setSongsData((prev) => new Map(prev).set(currentSong.sourceUrl, updatedSong))

  const updatedSongs = session.songs.map((song) =>
    song.url === currentSong.sourceUrl
      ? {
          ...song,
          customSections: isSimplified ? song.customSections : baseSections,
          customSimplifiedSections: isSimplified ? baseSections : song.customSimplifiedSections,
        }
      : song
  )
  const updatedSession = { ...session, songs: updatedSongs }
  await sessionStore.updateSession(updatedSession)
  setSession(updatedSession)
}
```

Persistence rules inherited from the existing handlers (do not change):
- Edits are stored as `customSections` / `customSimplifiedSections` on the session's song entry (also what share links carry via `ShareSongItem`).
- Edit the **base (original-key) sections**, never the transposed `displayedSong`. Positions are the same either way, but you must write back to the base so the transposed view re-derives correctly.
- Respect `isSimplified`: write to the simplified array when that view is active.

### Avoid a write per tap
`sessionStore.updateSession` is async/persistent. The upload modal applies nudges to in-memory state only. For the setlist:
- Keep a **local draft** `pendingPos` in `SessionPage` (or the toolbar component) while the user presses `<` / `>`.
- Render the preview from the draft (apply `setChordPos` on a derived copy of `displayedSong.sections`).
- **Persist once on ✓ Confirm** via `handleMoveChord`. On ✕, drop the draft, with nothing to restore in storage.

## 6. Gotchas / checklist

- [ ] Use `chordIndex` from the original `chords` array. Never the sorted index.
- [ ] Gate on `line.kind === 'lyric'` (`getChordPos` returns `null` otherwise).
- [ ] `setChordPos` clamps to `[0, text.length]`. Lines padded by the extractor (trailing spaces) allow moving into the padding.
- [ ] Moving past another chord is allowed (two chords at the same `pos` render fine, stable by index).
- [ ] Multi-column layouts (`columns-2/3`) work unchanged. The segment renderer is flow-based.
- [ ] Delete section / reorder sections change `sectionIndex`. Clear `selectedChord` when sections mutate.
- [ ] Clear selection when leaving edit mode, switching songs, or toggling simplified.
- [ ] Add tests next to `chordNudge.test.ts` if you add helpers (e.g. word-jump).

## 7. Possible follow-ups

- **Jump by word:** add `nudgeChordToWord(sections, s, l, c, dir)` that moves `pos` to the previous/next word boundary in `line.text` (`/\S+/g` match starts). Useful on long lines.
- **Hold-to-repeat** on `<` / `>`.
- Keyboard: ← / → while a chord is selected.

## 8. File map

| File | Role |
|---|---|
| `src/lib/chordNudge.ts` | Pure move/clamp helpers (+ `.test.ts`) |
| `src/components/SongSheet.tsx` | `renderLyricSegments`, `onChordSelect`, `selectedChord` |
| `src/components/UploadSheetModal.tsx` | Reference implementation of select / nudge / confirm / cancel toolbar |
| `src/pages/SessionPage.tsx` | Setlist edit mode: add `handleMoveChord`, wire toolbar |
| `src/lib/transpose.ts` | Rewrites `chord` only; never touches `pos` |
