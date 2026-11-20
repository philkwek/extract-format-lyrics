import { describe, expect, it } from 'vitest'
import type { Section } from '../../src/types/song'
import { getColumnDisplayWidths, partitionSections } from '../../src/lib/songLayout'
import { nextFontSizeAfterOverflow, selectFitLayout } from '../../src/lib/useFitToScreen'

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

const baseOptions = {
  charWidthAt16Px: 9.6,
  columnGapPx: 32,
  sectionGapPx: 32,
}

describe('selectFitLayout', () => {
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
    expect(result).toEqual({ columns: 1, fontSizePx: 24, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 1, fontSizePx: 18, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 1, fontSizePx: 28, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 2, fontSizePx: 16, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 3, fontSizePx: 24, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 4, fontSizePx: 16, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 4, fontSizePx: 24, fitsOnScreen: true })
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
    expect(result).toEqual({ columns: 2, fontSizePx: 24, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 1, fontSizePx: 21, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 1, fontSizePx: 24, fitsOnScreen: true })
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

    expect(result).toEqual({ columns: 4, fontSizePx: 16, fitsOnScreen: true })
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
