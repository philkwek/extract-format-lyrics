import type { Line, Section } from '../types/song'

export type SheetColumns = 1 | 2 | 3 | 4

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
 * Allocates column widths using a smallest-first (water-filling) fair-share
 * strategy so narrower columns fit in full first and only columns that exceed
 * their fair share plus donated surplus get constrained.
 */
export function allocateColumnWidths(
  intrinsicWidths: number[],
  availableWidthCh?: number,
): number[] {
  const count = intrinsicWidths.length
  if (count === 0) return []
  const sanitized = intrinsicWidths.map((width) => Math.max(width, 1))
  if (count === 1) return sanitized

  const totalNeeded = sanitized.reduce((sum, width) => sum + width, 0)
  // When container width is not yet measured, fall back to a standard 114ch multi-column budget
  const budget =
    availableWidthCh !== undefined && Number.isFinite(availableWidthCh) && availableWidthCh > 0
      ? availableWidthCh
      : 114

  if (totalNeeded <= budget) {
    const extraPerColumn = (budget - totalNeeded) / count
    return sanitized.map((width) => Number((width + extraPerColumn).toFixed(2)))
  }

  const allocated = new Array<number>(count).fill(0)
  const locked = new Array<boolean>(count).fill(false)
  let remainingBudget = budget
  let remainingCount = count

  while (remainingCount > 0) {
    const equalShare = remainingBudget / remainingCount
    let lockedAny = false

    for (let index = 0; index < count; index++) {
      if (!locked[index] && sanitized[index] <= equalShare) {
        locked[index] = true
        allocated[index] = sanitized[index]
        remainingBudget -= sanitized[index]
        remainingCount -= 1
        lockedAny = true
      }
    }

    if (!lockedAny) {
      const cappedShare = Math.max(remainingBudget / remainingCount, 1)
      for (let index = 0; index < count; index++) {
        if (!locked[index]) {
          allocated[index] = Number(cappedShare.toFixed(2))
        }
      }
      break
    }
  }

  return allocated
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
 * Estimates the rendered height of one section in pixels at a given sheet font
 * size. The renderer stacks a chord row above every lyric row, so lyric lines
 * take roughly 2.625em even when a line has no chords.
 */
export function estimateSectionHeightPx(section: Section, fontSizePx: number): number {
  let height = fontSizePx * 1.3 + 13 // section label, border and margins

  section.lines.forEach((line, index) => {
    if (line.kind === 'tab') {
      height += 12 * 1.5 + 2
    } else if (line.kind === 'chords-only') {
      height += fontSizePx * 1.5 + 4
    } else if (!line.text.trim() && line.chords.length === 0) {
      height += 12
    } else {
      height += fontSizePx * 2.625
    }
    if (index < section.lines.length - 1) height += 2 // space-y-0.5
  })

  return height
}

/** Estimates the tallest column height for a partitioned section set. */
export function estimateColumnHeightPx(
  column: ColumnSectionItem[],
  fontSizePx: number,
  sectionGapPx = 24,
): number {
  if (column.length === 0) return 0
  return (
    column.reduce((total, item) => total + estimateSectionHeightPx(item.section, fontSizePx), 0) +
    (column.length - 1) * sectionGapPx
  )
}

interface PartitionCandidate {
  maxWeight: number
  minWeight: number
  /** Split positions, always starting at 0 and ending at the section count. */
  splits: number[]
}

function comparePartitionCandidates(a: PartitionCandidate, b: PartitionCandidate): number {
  if (a.maxWeight !== b.maxWeight) return a.maxWeight - b.maxWeight
  const spreadA = a.maxWeight - a.minWeight
  const spreadB = b.maxWeight - b.minWeight
  if (spreadA !== spreadB) return spreadA - spreadB
  return a.splits.join(',').localeCompare(b.splits.join(','))
}

/**
 * Keeps the Pareto frontier of (tallest column, shortest column) candidates.
 * A candidate is dominated when another one is no taller and no shorter.
 */
function prunePartitionCandidates(candidates: PartitionCandidate[]): PartitionCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.maxWeight !== b.maxWeight) return a.maxWeight - b.maxWeight
    if (a.minWeight !== b.minWeight) return b.minWeight - a.minWeight
    return a.splits.join(',').localeCompare(b.splits.join(','))
  })

  const kept: PartitionCandidate[] = []
  for (const candidate of sorted) {
    const dominated = kept.some(
      (existing) =>
        existing.maxWeight <= candidate.maxWeight && existing.minWeight >= candidate.minWeight,
    )
    if (!dominated) kept.push(candidate)
  }
  return kept
}

/**
 * Partitions an ordered array of song sections into N balanced columns (1–4)
 * while strictly preserving musical chronological reading order (Column 1 ->
 * Column 2 -> Column 3 -> Column 4).
 *
 * This eliminates the WebKit / Safari CSS multi-column bug where column-fill:
 * balance stops filling at the viewport height and leaves trailing columns empty.
 */
export function partitionSections(
  sections: Section[],
  numColumns: SheetColumns,
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

  // dp[k][i] contains the Pareto-optimal partition of the first i sections into
  // k non-empty groups. Keeping multiple states preserves the best possible
  // spread when the tallest column is tied later.
  const dp: PartitionCandidate[][][] = Array.from({ length: numColumns + 1 }, () =>
    Array.from({ length: M + 1 }, () => [] as PartitionCandidate[]),
  )

  for (let i = 1; i <= M; i++) {
    const weight = rangeWeight(0, i)
    dp[1][i] = [{ maxWeight: weight, minWeight: weight, splits: [0, i] }]
  }

  for (let columns = 2; columns <= numColumns; columns++) {
    for (let end = columns; end <= M; end++) {
      const candidates: PartitionCandidate[] = []
      for (let start = columns - 1; start < end; start++) {
        const weight = rangeWeight(start, end)
        for (const previous of dp[columns - 1][start]) {
          candidates.push({
            maxWeight: Math.max(previous.maxWeight, weight),
            minWeight: Math.min(previous.minWeight, weight),
            splits: [...previous.splits, end],
          })
        }
      }
      dp[columns][end] = prunePartitionCandidates(candidates)
    }
  }

  const best = [...dp[numColumns][M]].sort(comparePartitionCandidates)[0]
  if (!best) {
    // Defensive fallback: keep the musical order in a single column.
    return [items.map((item) => ({ section: item.section, originalIndex: item.originalIndex }))]
  }

  return best.splits.slice(0, -1).map((start, index) => {
    const end = best.splits[index + 1]
    return items
      .slice(start, end)
      .map((item) => ({ section: item.section, originalIndex: item.originalIndex }))
  })
}
