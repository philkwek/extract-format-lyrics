import { describe, expect, it } from 'vitest'
import type { Section } from '../../src/types/song'
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
  it('leaves the preferred layout alone when it already fits', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 4)],
      viewportWidthPx: 1000,
      viewportHeightPx: 1000,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result).toEqual({ columns: 1, fontSizePx: 14, fitsOnScreen: true })
  })

  it('adds columns at the same font size before shrinking text', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse 1', 10), makeSection('Chorus', 10)],
      viewportWidthPx: 1000,
      viewportHeightPx: 500,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result).toEqual({ columns: 2, fontSizePx: 14, fitsOnScreen: true })
  })

  it('uses a fourth column when it is the first layout that fits', () => {
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

    expect(result).toEqual({ columns: 4, fontSizePx: 14, fitsOnScreen: true })
  })

  it('keeps a manually preferred fourth column when it fits', () => {
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

    expect(result.columns).toBe(4)
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

  it('shrinks the font only after all other column counts fail', () => {
    const result = selectFitLayout({
      ...baseOptions,
      sections: [makeSection('Verse', 13)],
      viewportWidthPx: 1000,
      viewportHeightPx: 510,
      preferredColumns: 1,
      preferredFontSizePx: 14,
    })

    expect(result).toEqual({ columns: 1, fontSizePx: 13, fitsOnScreen: true })
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

  it('uses one column below the responsive multi-column breakpoint', () => {
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

    expect(result.columns).toBe(1)
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
