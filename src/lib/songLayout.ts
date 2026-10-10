import type { Line, Section } from '../types/song'

export interface ColumnSectionItem {
  section: Section
  originalIndex: number
}

/**
 * Returns the rendered width of a line in monospace character cells.
 *
 * Lyric lines are rendered as flex segments. A chord segment must be wide
 * enough for either its lyric slice or its chord label plus the 1ch gap that
 * follows it, so measuring the raw lyric string alone would under-estimate
 * the column width.
 */
export function getLineDisplayWidth(line: Line): number {
  if (line.kind === 'tab') {
    return line.raw.length
  }

  if (line.kind === 'chords-only') {
    return line.chords.join('   ').length
  }

  if (!line.text && line.chords.length === 0) {
    return 0
  }

  const sortedChords = line.chords
    .map((chord, originalIndex) => ({ ...chord, originalIndex }))
    .sort((a, b) => a.pos - b.pos || a.originalIndex - b.originalIndex)

  const textLength = line.text.length
  const clampPosition = (position: number) => Math.min(Math.max(position, 0), textLength)
  let width = 0
  const firstPos = sortedChords.length > 0 ? clampPosition(sortedChords[0].pos) : textLength

  if (firstPos > 0 || sortedChords.length === 0) {
    // The renderer reserves one cell for the empty chord row in this segment.
    width += Math.max(1, line.text.slice(0, firstPos).length)
  }

  for (let index = 0; index < sortedChords.length; index++) {
    const chord = sortedChords[index]
    const start = clampPosition(chord.pos)
    const nextChord = sortedChords[index + 1]
    const end = nextChord ? Math.max(start, clampPosition(nextChord.pos)) : textLength
    const lyricWidth = Math.max(1, line.text.slice(start, end).length)
    const chordWidth = chord.chord.length + 1 // The renderer applies padding-right: 1ch.
    width += Math.max(lyricWidth, chordWidth)
  }

  return width
}

/** Returns the intrinsic text width required by a section in character cells. */
export function getSectionDisplayWidth(section: Section): number {
  return Math.max(section.label.length, ...section.lines.map(getLineDisplayWidth), 1)
}

/**
 * Computes one intrinsic width for each partitioned column. Empty columns are
 * excluded so an absent third section does not reserve horizontal space.
 */
export function getColumnDisplayWidths(columns: ColumnSectionItem[][]): number[] {
  return columns
    .filter((column) => column.length > 0)
    .map((column) => Math.max(...column.map((item) => getSectionDisplayWidth(item.section)), 1))
}

/**
 * Computes an estimated vertical weight (visual height in line units) for a section.
 * Includes section header and spacing overhead plus line weights.
 */
export function getSectionWeight(section: Section): number {
  let linesWeight = 0
  for (const line of section.lines) {
    if (line.kind === 'tab') {
      linesWeight += 1
    } else if (line.kind === 'chords-only') {
      linesWeight += 1.5
    } else if (line.kind === 'lyric') {
      if (!line.text.trim() && line.chords.length === 0) {
        linesWeight += 0.5
      } else if (line.chords.length > 0 && line.text.trim()) {
        // Lyrics with chords above take ~2 lines of height
        linesWeight += 2
      } else {
        linesWeight += 1
      }
    }
  }
  // Section header (label, border, margin) contributes ~2.5 lines of visual weight
  return linesWeight + 2.5
}

/**
 * Partitions an ordered array of song sections into N balanced columns (1, 2, or 3)
 * while strictly preserving musical chronological reading order (Column 1 -> Column 2 -> Column 3).
 *
 * This eliminates the WebKit / Safari CSS multi-column bug where column-fill: balance
 * stops filling at the viewport height and leaves trailing columns empty.
 */
export function partitionSections(
  sections: Section[],
  numColumns: 1 | 2 | 3
): ColumnSectionItem[][] {
  if (!sections || sections.length === 0) {
    return [[]]
  }

  if (numColumns === 1 || sections.length === 1) {
    return [sections.map((section, originalIndex) => ({ section, originalIndex }))]
  }

  const items = sections.map((section, originalIndex) => ({
    section,
    originalIndex,
    weight: getSectionWeight(section),
  }))

  const M = items.length

  // If there are fewer or equal sections than columns, give 1 section to each column
  if (M <= numColumns) {
    const cols: ColumnSectionItem[][] = []
    for (let c = 0; c < numColumns; c++) {
      if (c < M) {
        cols.push([{ section: items[c].section, originalIndex: items[c].originalIndex }])
      } else {
        cols.push([])
      }
    }
    return cols
  }

  // Precompute prefix sums of weights for fast range-sum queries
  const prefixWeights = new Array(M + 1).fill(0)
  for (let k = 0; k < M; k++) {
    prefixWeights[k + 1] = prefixWeights[k] + items[k].weight
  }
  const rangeWeight = (start: number, end: number) => prefixWeights[end] - prefixWeights[start]

  if (numColumns === 2) {
    let bestSplit = 1
    let bestDiff = Infinity

    for (let i = 1; i < M; i++) {
      const w0 = rangeWeight(0, i)
      const w1 = rangeWeight(i, M)
      const diff = Math.abs(w0 - w1)
      if (diff < bestDiff) {
        bestDiff = diff
        bestSplit = i
      }
    }

    return [
      items.slice(0, bestSplit).map((it) => ({ section: it.section, originalIndex: it.originalIndex })),
      items.slice(bestSplit).map((it) => ({ section: it.section, originalIndex: it.originalIndex })),
    ]
  }

  // numColumns === 3
  let bestI = 1
  let bestJ = 2
  let bestScore = Infinity
  let bestMax = Infinity

  for (let i = 1; i < M - 1; i++) {
    for (let j = i + 1; j < M; j++) {
      const w0 = rangeWeight(0, i)
      const w1 = rangeWeight(i, j)
      const w2 = rangeWeight(j, M)
      const maxW = Math.max(w0, w1, w2)
      const minW = Math.min(w0, w1, w2)
      const diff = maxW - minW

      // Primary goal: minimize the tallest column height
      // Secondary goal: minimize the spread between columns
      if (maxW < bestMax || (maxW === bestMax && diff < bestScore)) {
        bestMax = maxW
        bestScore = diff
        bestI = i
        bestJ = j
      }
    }
  }

  return [
    items.slice(0, bestI).map((it) => ({ section: it.section, originalIndex: it.originalIndex })),
    items.slice(bestI, bestJ).map((it) => ({ section: it.section, originalIndex: it.originalIndex })),
    items.slice(bestJ).map((it) => ({ section: it.section, originalIndex: it.originalIndex })),
  ]
}
