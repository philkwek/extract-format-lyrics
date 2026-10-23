import type { ChordPlacement, Line } from '../types/song'
import { getLyricSplitPositions } from './lineSplit'
import { getLineDisplayWidth } from './songLayout'

type LyricLine = Extract<Line, { kind: 'lyric' }>

export interface WrappedChordPlacement extends ChordPlacement {
  /** Index of this chord in the original line.chords array. */
  originalIndex: number
}

export interface WrappedLyricRow {
  text: string
  chords: WrappedChordPlacement[]
  /** Character offset where this row starts in the original lyric text. */
  start: number
}

/** Returns the chords at or after `start`, shifted to `start`-relative positions. */
function chordsFrom(
  chords: WrappedChordPlacement[],
  start: number,
  end = Number.POSITIVE_INFINITY,
): WrappedChordPlacement[] {
  return chords
    .filter((chord) => chord.pos >= start && chord.pos < end)
    .map((chord) => ({ ...chord, pos: chord.pos - start }))
}

function rowDisplayWidth(text: string, chords: ChordPlacement[]): number {
  return getLineDisplayWidth({ kind: 'lyric', text, chords })
}

/**
 * Splits a lyric line into visual rows that fit within `maxWidthCh` character
 * cells. Breaks prefer the start of a word, and chord placements move with the
 * lyric text they sit above so the two never drift apart.
 *
 * This only changes what is drawn. The underlying line stays one line, so
 * split/merge editing and saved chord positions are untouched.
 */
export function wrapLyricLine(line: LyricLine, maxWidthCh: number): WrappedLyricRow[] {
  const limit = Math.max(1, Math.floor(maxWidthCh))
  const chords = line.chords.map((chord, originalIndex) => ({ ...chord, originalIndex }))

  if (line.text.length === 0 || getLineDisplayWidth(line) <= limit) {
    return [{ text: line.text, chords, start: 0 }]
  }

  const wordStarts = new Set(getLyricSplitPositions(line))
  const chordStarts = new Set(
    chords.map((chord) => chord.pos).filter((pos) => pos > 0 && pos <= line.text.length),
  )
  const rows: WrappedLyricRow[] = []
  let start = 0

  while (start < line.text.length) {
    const remainingText = line.text.slice(start)
    const remainingChords = chordsFrom(chords, start)
    if (rowDisplayWidth(remainingText, remainingChords) <= limit) {
      rows.push({ text: remainingText, chords: remainingChords, start })
      break
    }

    // Find the furthest character that still fits. A chord anchored exactly at
    // the break belongs to the next row, so it is excluded from this measurement.
    let fittingEnd = start + 1
    for (let end = start + 1; end < line.text.length; end++) {
      const width = rowDisplayWidth(
        line.text.slice(start, end),
        chordsFrom(chords, start, end),
      )
      if (width > limit) break
      fittingEnd = end
    }

    // Prefer a word start so wrapped lines read naturally. A chord anchor is
    // the next best break; a hard character break is the last resort for a
    // single word that is wider than the sheet column.
    let breakAt = fittingEnd
    let foundWordBreak = false
    for (let position = fittingEnd; position > start; position--) {
      if (wordStarts.has(position)) {
        breakAt = position
        foundWordBreak = true
        break
      }
    }
    if (!foundWordBreak) {
      for (let position = fittingEnd; position > start; position--) {
        if (chordStarts.has(position)) {
          breakAt = position
          break
        }
      }
    }
    if (breakAt <= start) breakAt = start + 1

    rows.push({
      text: line.text.slice(start, breakAt),
      chords: chordsFrom(chords, start, breakAt),
      start,
    })
    start = breakAt
  }

  return rows
}
