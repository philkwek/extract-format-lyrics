// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Line, Section } from '../../src/types/song'
import {
  allocateColumnWidths,
  estimateColumnHeightPx,
  getColumnDisplayWidths,
  partitionSections,
  type SheetColumns,
} from '../../src/lib/songLayout'
import { wrapLyricLine } from '../../src/lib/lyricWrap'
import {
  nextFontSizeAfterOverflow,
  selectFitLayout,
  useFitToScreen,
} from '../../src/lib/useFitToScreen'

function makeSection(label: string, lineCount: number, lineText = 'Line text'): Section {
  return {
    type: 'Verse',
    label,
    lines: Array.from({ length: lineCount }, (_, index) => ({
      kind: 'lyric',
      text: `${lineText} ${index + 1}`,
      chords: [{ chord: 'G', pos: 0 }],
    })),
  }
}

function chordPositions(length: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.floor((length * index) / count))
}

/** Builds a section of placeholder lines; 0-length entries are blank spacer lines. */
function makeLongLineSection(
  label: string,
  lengths: number[],
  chordsForLength: (length: number) => number,
): Section {
  const lines: Line[] = lengths.map((length) => {
    if (length === 0) return { kind: 'lyric', text: '', chords: [] }
    const positions = chordPositions(length, chordsForLength(length))
    return {
      kind: 'lyric',
      text: 'x'.repeat(length),
      chords: positions.map((pos) => ({ chord: 'G', pos })),
    }
  })
  return { type: 'Verse', label, lines }
}

const longLines = (length: number) => (length >= 33 ? 2 : 1)

/** Seven sections of placeholder lines; the longest are 47 and 44 characters. */
const sevenSections = [
  makeLongLineSection('Verse 1', [17, 18, 41, 0, 20, 17, 47], longLines),
  makeLongLineSection('Pre-Chorus', [18, 18], longLines),
  makeLongLineSection('Chorus', [25, 33, 18], longLines),
  makeLongLineSection('Verse 2', [26, 16, 39, 0, 17, 23, 43], longLines),
  makeLongLineSection('Pre-Chorus', [16, 16], longLines),
  makeLongLineSection('Bridge', [26, 27, 29, 33], () => 4),
  makeLongLineSection('Bridge 2', [18, 18, 44], longLines),
]

/** SongSheet's wrap width per column, rebuilt from the layout the fit picked. */
function wrapWidthsFor(
  layout: { columns: SheetColumns; fontSizePx: number },
  sections: Section[],
  viewportWidthPx: number,
  columnGapPx: number,
  charWidthAt16Px: number,
): number[] {
  const visible = partitionSections(sections, layout.columns).filter(
    (partition) => partition.length > 0,
  )
  const usableWidthPx = viewportWidthPx - columnGapPx * (visible.length - 1)
  const charWidthPx = charWidthAt16Px * (layout.fontSizePx / 16)
  const availableWidthCh = Math.max(visible.length, Math.floor(usableWidthPx / charWidthPx) - 1)
  const allocatedWidths = allocateColumnWidths(getColumnDisplayWidths(visible), availableWidthCh)
  const widths = allocatedWidths.length === 1 ? [availableWidthCh] : allocatedWidths
  return widths.map((width) => Math.max(1, Math.floor(width) - 1))
}

/** Most rows any lyric line takes in the layout, using that column's wrap width. */
function maxWrappedRows(
  layout: { columns: SheetColumns; fontSizePx: number },
  sections: Section[],
  viewportWidthPx: number,
  columnGapPx = 32,
  charWidthAt16Px = 9.63,
): number {
  const widths = wrapWidthsFor(layout, sections, viewportWidthPx, columnGapPx, charWidthAt16Px)
  const visible = partitionSections(sections, layout.columns).filter(
    (partition) => partition.length > 0,
  )
  let rows = 1
  visible.forEach((column, index) => {
    for (const item of column) {
      for (const line of item.section.lines) {
        if (line.kind !== 'lyric' || line.text.length === 0) continue
        rows = Math.max(rows, wrapLyricLine(line, widths[index]).length)
      }
    }
  })
  return rows
}

const baseOptions = {
  charWidthAt16Px: 9.6,
  columnGapPx: 32,
  sectionGapPx: 32,
}

describe('selectFitLayout', () => {
  it('steps the text down when a title block takes height from column 1', () => {
    const options = {
      ...baseOptions,
      sections: [makeSection('Verse', 4)],
      viewportWidthPx: 1000,
      viewportHeightPx: 320,
      preferredColumns: 1 as SheetColumns,
      preferredFontSizePx: 14,
    }

    expect(selectFitLayout(options).fontSizePx).toBe(24)
    const withBlock = selectFitLayout({ ...options, leadingBlock: true })
    expect(withBlock.fontSizePx).toBeLessThan(24)
    expect(withBlock.fitsOnScreen).toBe(true)
  })

  it('grows a short song above the preferred size to fill a big screen', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 4)],
      viewportWidthPx: 1000,
      viewportHeightPx: 1000,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result.fontSizePx).toBeGreaterThan(14)
    expect(result).toMatchObject({ columns: 1, fontSizePx: 24, fitsOnScreen: true })
  })

  it('stops growing at maxFontSizePx', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 4)],
      viewportWidthPx: 1000,
      viewportHeightPx: 2000,
      preferredColumns: 1,
      preferredFontSizePx: 14,
      maxFontSizePx: 18,
    })

    expect(result).toMatchObject({ columns: 1, fontSizePx: 18, fitsOnScreen: true })
  })

  it('starts at the preferred size when it is larger than maxFontSizePx', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 4)],
      viewportWidthPx: 1000,
      viewportHeightPx: 2000,
      preferredColumns: 1,
      preferredFontSizePx: 28,
      maxFontSizePx: 18,
    })

    expect(result).toMatchObject({ columns: 1, fontSizePx: 28, fitsOnScreen: true })
  })

  it('picks the widest column count that fits at the largest font size', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse 1', 10), makeSection('Chorus', 10)],
      viewportWidthPx: 1000,
      viewportHeightPx: 500,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result).toMatchObject({ columns: 2, fontSizePx: 16, fitsOnScreen: true })
  })

  it('prefers three columns over two when both fit at the largest size', () => {
    const sections = [
      makeSection('Verse 1', 8),
      makeSection('Chorus', 8),
      makeSection('Verse 2', 8),
      makeSection('Bridge', 8),
      makeSection('Verse 3', 8),
      makeSection('Ending', 8),
    ]
    const result = selectFitLayout({
      ...baseOptions,
      sections,
      viewportWidthPx: 640,
      viewportHeightPx: 1800,
      preferredColumns: 2,
      preferredFontSizePx: 14,
    })

    expect(result).toMatchObject({ columns: 3, fontSizePx: 24, fitsOnScreen: true })
  })

  it('uses a fourth column when it fits at the largest font size', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [
        makeSection('Verse 1', 10),
        makeSection('Chorus', 10),
        makeSection('Verse 2', 10),
        makeSection('Bridge', 10),
      ],
      viewportWidthPx: 1200,
      viewportHeightPx: 500,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result).toMatchObject({ columns: 4, fontSizePx: 16, fitsOnScreen: true })
  })

  it('grows four columns when the sheet is short', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [
        makeSection('Verse 1', 6),
        makeSection('Chorus', 6),
        makeSection('Verse 2', 6),
        makeSection('Bridge', 6),
      ],
      viewportWidthPx: 1200,
      viewportHeightPx: 800,
      preferredColumns: 4,
      preferredFontSizePx: 14,
    })

    expect(result).toMatchObject({ columns: 4, fontSizePx: 24, fitsOnScreen: true })
  })

  it('rejects a fourth column when the columns would overflow horizontally', () => {
    const longLine = 'This is a deliberately very long lyric line that needs plenty of width'
    const result = selectFitLayout({
      ...baseOptions,
      sections: [
        makeSection('Verse 1', 10, longLine),
        makeSection('Chorus', 10, longLine),
        makeSection('Verse 2', 10, longLine),
        makeSection('Bridge', 10, longLine),
      ],
      viewportWidthPx: 1200,
      viewportHeightPx: 500,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result.columns).toBeLessThan(4)
  })

  it('drops to fewer columns when the longest line would be too narrow', () => {
    const longLine = 'This is a deliberately very long lyric line that needs plenty of width'
    const result = selectFitLayout({
      ...baseOptions,
      sections: [
        makeSection('Verse 1', 3, longLine),
        makeSection('Chorus', 3),
        makeSection('Verse 2', 3),
        makeSection('Bridge', 3),
      ],
      viewportWidthPx: 1450,
      viewportHeightPx: 1000,
      preferredColumns: 4,
      preferredFontSizePx: 14,
    })

    // Three columns would leave the long line one character short of the wrap room.
    expect(result).toMatchObject({ columns: 2, fontSizePx: 24, fitsOnScreen: true })
  })

  it('leaves the one-character room the sheet keeps before it wraps a line', () => {
    const section = makeSection('Verse', 1, 'x'.repeat(30))
    const [intrinsic] = getColumnDisplayWidths(partitionSections([section], 1))
    // At 24px each character is 14.4px; this width gives exactly `intrinsic` characters.
    const viewportWidthPx = (intrinsic + 1) * 14.4 + 1

    const result = selectFitLayout({
      ...baseOptions,
      sections: [section],
      viewportWidthPx,
      viewportHeightPx: 2000,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result.fontSizePx).toBeLessThan(24)
  })

  it('shrinks text only as far as needed to fit one column', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 13)],
      viewportWidthPx: 1000,
      viewportHeightPx: 800,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result).toMatchObject({ columns: 1, fontSizePx: 21, fitsOnScreen: true })
  })

  it('picks a larger font when the height estimate is scaled down', () => {
    const options = {
      ...baseOptions,
      sections: [makeSection('Verse', 13)],
      viewportWidthPx: 1000,
      viewportHeightPx: 800,
      preferredColumns: 1 as const,
      preferredFontSizePx: 14,
    }
    const full = selectFitLayout(options)
    const calibrated = selectFitLayout({ ...options, heightScale: 0.85 })

    expect(full.fontSizePx).toBe(21)
    expect(calibrated.fontSizePx).toBeGreaterThan(full.fontSizePx)
  })

  it('returns the estimated height of the layout it picked', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 13)],
      viewportWidthPx: 1000,
      viewportHeightPx: 800,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result.fitsOnScreen).toBe(true)
    expect(result.estimatedHeightPx).toBeGreaterThan(0)
    expect(result.estimatedHeightPx).toBeLessThanOrEqual(800)
  })

  it('reports that the sheet cannot fit at the minimum readable size', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 100)],
      viewportWidthPx: 1000,
      viewportHeightPx: 400,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result.fontSizePx).toBe(11)
    expect(result.fitsOnScreen).toBe(false)
  })

  it('grows text but keeps one column below the responsive breakpoint', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [
        makeSection('Verse 1', 4),
        makeSection('Chorus', 4),
        makeSection('Verse 2', 4),
        makeSection('Bridge', 4),
      ],
      viewportWidthPx: 500,
      viewportHeightPx: 2000,
      preferredColumns: 4,
      preferredFontSizePx: 14,
    })

    expect(result).toMatchObject({ columns: 1, fontSizePx: 24, fitsOnScreen: true })
  })

  it('returns the preferred layout for an empty sheet', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [],
      viewportWidthPx: 1000,
      viewportHeightPx: 500,
      preferredColumns: 4,
      preferredFontSizePx: 16,
    })

    expect(result).toMatchObject({ columns: 4, fontSizePx: 16, fitsOnScreen: true })
  })

  it('fits more columns at a larger size when wrapped lines are allowed', () => {
    const options = {
      ...baseOptions,
      sections: sevenSections,
      viewportWidthPx: 976,
      viewportHeightPx: 677,
      preferredColumns: 1 as const,
      preferredFontSizePx: 14,
      charWidthAt16Px: 9.63,
    }
    const unwrapped = selectFitLayout(options)
    const wrapped = selectFitLayout({ ...options, wrapLines: true })

    expect(unwrapped.columns).toBe(2)
    expect(wrapped.columns).toBeGreaterThan(unwrapped.columns)
    expect(wrapped.fontSizePx).toBeGreaterThan(unwrapped.fontSizePx)
    expect(maxWrappedRows(wrapped, sevenSections, 976)).toBeLessThanOrEqual(2)
  })

  it('never accepts a wrapped layout where a line needs three rows', () => {
    const sections = [
      makeLongLineSection('Verse 1', [120, 18, 17], longLines),
      makeLongLineSection('Chorus', [18, 120, 17], longLines),
      makeLongLineSection('Verse 2', [17, 18, 120], longLines),
      makeLongLineSection('Bridge', [18, 17, 18], longLines),
    ]
    const result = selectFitLayout({
      ...baseOptions,
      sections,
      viewportWidthPx: 700,
      viewportHeightPx: 900,
      preferredColumns: 1,
      preferredFontSizePx: 14,
      charWidthAt16Px: 9.63,
      wrapLines: true,
    })

    // A 120-character line only fits two rows from 19px down; wider text is rejected.
    expect(result.columns).toBe(1)
    expect(result.fitsOnScreen).toBe(true)
    expect(maxWrappedRows(result, sections, 700)).toBeLessThanOrEqual(2)
  })
})

describe('nextFontSizeAfterOverflow', () => {
  it('jumps toward the size that should fit instead of stepping 1px', () => {
    // Content is 2x too tall at 20px, so ~10px is the target; floor is 11.
    expect(nextFontSizeAfterOverflow(20, 11, 500, 1000)).toBe(11)
    // Content is 20% too tall at 20px -> 17px (ceil of 16.67).
    expect(nextFontSizeAfterOverflow(20, 11, 500, 600)).toBe(17)
  })

  it('always moves down by at least 1px and never below the floor', () => {
    expect(nextFontSizeAfterOverflow(14, 11, 500, 501)).toBe(13)
    expect(nextFontSizeAfterOverflow(12, 11, 100, 1000)).toBe(11)
  })

  it('falls back to a 1px step when heights are unusable', () => {
    expect(nextFontSizeAfterOverflow(14, 11, 0, 0)).toBe(13)
    expect(nextFontSizeAfterOverflow(14, 11, 500, 0)).toBe(13)
  })
})

describe('useFitToScreen', () => {
  afterEach(cleanup)

  it('re-picks once at the measured scale when the real content is shorter', async () => {
    const sections = [makeSection('Verse', 13)]
    const viewportWidthPx = 500
    const viewportHeightPx = 800
    const firstPick = selectFitLayout({
      sections,
      viewportWidthPx,
      viewportHeightPx,
      preferredColumns: 1,
      preferredFontSizePx: 14,
      charWidthAt16Px: 9.6,
      columnGapPx: 24,
      sectionGapPx: 24,
    })
    expect(firstPick.fontSizePx).toBeLessThan(24)

    // jsdom lays nothing out, so the sheet's height is stubbed at 85% of the estimate.
    const viewport = document.createElement('div')
    const sheet = document.createElement('div')
    sheet.setAttribute('data-song-sheet', '')
    viewport.appendChild(sheet)
    document.body.appendChild(viewport)
    Object.defineProperty(viewport, 'clientWidth', { value: viewportWidthPx })
    Object.defineProperty(viewport, 'clientHeight', { value: viewportHeightPx })

    const { result } = renderHook(() =>
      useFitToScreen({
        enabled: true,
        sections,
        preferredColumns: 1,
        preferredFontSizePx: 14,
      }),
    )
    const [column] = partitionSections(sections, 1)
    Object.defineProperty(sheet, 'scrollHeight', {
      configurable: true,
      get: () =>
        Math.round(estimateColumnHeightPx(column, result.current.layout.fontSizePx, 24) * 0.85),
    })

    await act(async () => {
      result.current.viewportRef(viewport)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(result.current.layout.fitsOnScreen).toBe(true)
    expect(result.current.layout.fontSizePx).toBeGreaterThan(firstPick.fontSizePx)
    viewport.remove()
  })
})
