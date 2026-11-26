import { describe, expect, it } from 'vitest'
import {
  resolveScaledFit,
  searchLargestFit,
  toPresenterSections,
} from '../../src/lib/presenterFit'
import type { SharedLyricsSong } from '../../src/types/song'

describe('searchLargestFit', () => {
  it('picks the largest font across the column counts', () => {
    const result = searchLargestFit((font, columns) => font <= columns * 10, {
      minFontPx: 10,
      maxFontPx: 40,
      maxColumns: 3,
    })

    expect(result).toEqual({ fontPx: 30, columns: 3, fitsOnScreen: true })
  })

  it('keeps fewer columns when two layouts fit at the same font', () => {
    const result = searchLargestFit((font) => font <= 22, {
      minFontPx: 10,
      maxFontPx: 40,
      maxColumns: 3,
    })

    expect(result).toEqual({ fontPx: 22, columns: 1, fitsOnScreen: true })
  })

  it('stops at the first column count that fits the maximum font', () => {
    const calls: Array<[number, number]> = []
    const result = searchLargestFit(
      (font, columns) => {
        calls.push([font, columns])
        return true
      },
      { minFontPx: 10, maxFontPx: 40, maxColumns: 3 },
    )

    expect(result).toEqual({ fontPx: 40, columns: 1, fitsOnScreen: true })
    expect(calls.every(([, columns]) => columns === 1)).toBe(true)
  })

  it('reports the minimum font and every column when nothing fits', () => {
    const result = searchLargestFit(() => false, {
      minFontPx: 10,
      maxFontPx: 40,
      maxColumns: 3,
    })

    expect(result).toEqual({ fontPx: 10, columns: 3, fitsOnScreen: false })
  })

  it('bounds the number of measurement calls', () => {
    let calls = 0
    const result = searchLargestFit(
      (font, columns) => {
        calls += 1
        return font <= 40 - columns * 5
      },
      { minFontPx: 10, maxFontPx: 60, maxColumns: 3 },
    )

    const bound = 3 * Math.ceil(Math.log2(60 - 10 + 1)) + 3
    expect(result).toEqual({ fontPx: 35, columns: 1, fitsOnScreen: true })
    expect(calls).toBeLessThanOrEqual(bound)
  })

  it('never asks about more columns than the maximum', () => {
    const seen = new Set<number>()
    searchLargestFit(
      (_font, columns) => {
        seen.add(columns)
        return false
      },
      { minFontPx: 12, maxFontPx: 24, maxColumns: 2 },
    )

    expect([...seen].sort()).toEqual([1, 2])
  })
})

describe('toPresenterSections', () => {
  it('turns every lyric line into a chord-free section line', () => {
    const song: SharedLyricsSong = {
      entryId: 'entry_1',
      title: 'Demo song',
      sections: [
        { label: 'Verse 1', lines: ['First line', 'Second line'] },
        { label: 'Chorus', lines: [] },
      ],
    }

    expect(toPresenterSections(song)).toEqual([
      {
        type: 'Other',
        label: 'Verse 1',
        lines: [
          { kind: 'lyric', text: 'First line', chords: [] },
          { kind: 'lyric', text: 'Second line', chords: [] },
        ],
      },
      { type: 'Other', label: 'Chorus', lines: [] },
    ])
  })
})

describe('resolveScaledFit', () => {
  it('scales relative to the fitted size when a long song already hit its fit ceiling', () => {
    const fits = (font: number) => font <= 26
    const base = { minFontPx: 14, maxFontPx: 56, maxColumns: 3 }

    expect(resolveScaledFit(fits, { ...base, textScale: 100 })).toEqual({
      fontPx: 26,
      columns: 1,
      fitsOnScreen: true,
    })
    expect(resolveScaledFit(fits, { ...base, textScale: 80 })).toEqual({
      fontPx: 21,
      columns: 1,
      fitsOnScreen: true,
    })
    expect(resolveScaledFit(fits, { ...base, textScale: 120 })).toEqual({
      fontPx: 31,
      columns: 1,
      fitsOnScreen: false,
    })
  })

  it('grows a short song that had headroom at 100% and keeps it fitted when possible', () => {
    const fits = (font: number) => font <= 80
    const base = { minFontPx: 14, maxFontPx: 56, maxColumns: 3 }

    expect(resolveScaledFit(fits, { ...base, textScale: 120 })).toEqual({
      fontPx: 67,
      columns: 1,
      fitsOnScreen: true,
    })
  })
})
