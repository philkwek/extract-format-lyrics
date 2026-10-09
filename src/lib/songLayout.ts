import type { Section } from '../types/song'

export interface ColumnSectionItem {
  section: Section
  originalIndex: number
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
