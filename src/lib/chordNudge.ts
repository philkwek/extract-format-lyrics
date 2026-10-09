import type { Section } from '../types/song'

/**
 * Returns the chord's `pos` clamped into the lyric text bounds, or null if the
 * target is not a lyric-line chord.
 */
export function getChordPos(
  sections: Section[],
  sectionIndex: number,
  lineIndex: number,
  chordIndex: number
): number | null {
  const line = sections[sectionIndex]?.lines[lineIndex]
  if (!line || line.kind !== 'lyric') return null
  return line.chords[chordIndex]?.pos ?? null
}

/** Sets a lyric chord's pos (clamped to [0, text.length]). Returns a new sections array. */
export function setChordPos(
  sections: Section[],
  sectionIndex: number,
  lineIndex: number,
  chordIndex: number,
  pos: number
): Section[] {
  return sections.map((section, si) => {
    if (si !== sectionIndex) return section
    return {
      ...section,
      lines: section.lines.map((line, li) => {
        if (li !== lineIndex || line.kind !== 'lyric') return line
        const clamped = Math.max(0, Math.min(line.text.length, Math.round(pos)))
        return {
          ...line,
          chords: line.chords.map((c, ci) => (ci === chordIndex ? { ...c, pos: clamped } : c)),
        }
      }),
    }
  })
}

/** Moves a lyric chord by `delta` characters (negative = left). Array index of the chord is preserved. */
export function nudgeChord(
  sections: Section[],
  sectionIndex: number,
  lineIndex: number,
  chordIndex: number,
  delta: number
): Section[] {
  const current = getChordPos(sections, sectionIndex, lineIndex, chordIndex)
  if (current === null) return sections
  return setChordPos(sections, sectionIndex, lineIndex, chordIndex, current + delta)
}
