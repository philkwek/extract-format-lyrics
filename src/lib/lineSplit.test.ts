import { describe, expect, it } from 'vitest'
import {
  getLyricSplitPositions,
  mergeLyricLines,
  mergeSectionLyricLineWithPrevious,
  splitLyricLine,
  splitSectionLyricLine,
} from './lineSplit'
import type { Line, Section } from '../types/song'

const lyricLine: Line = {
  kind: 'lyric',
  text: 'Amazing grace how sweet',
  chords: [
    { chord: 'G', pos: 0 },
    { chord: 'C', pos: 8 },
    { chord: 'D', pos: 14 },
  ],
}

describe('lineSplit', () => {
  it('offers only boundaries between words', () => {
    expect(getLyricSplitPositions(lyricLine)).toEqual([8, 14, 18])
    expect(getLyricSplitPositions({ kind: 'tab', raw: 'e|---0---|' })).toEqual([])
  })

  it('preserves text and moves chords at or after the chosen boundary', () => {
    const split = splitLyricLine(lyricLine, 14)
    expect(split).toEqual([
      {
        kind: 'lyric',
        text: 'Amazing grace ',
        chords: [
          { chord: 'G', pos: 0 },
          { chord: 'C', pos: 8 },
        ],
      },
      {
        kind: 'lyric',
        text: 'how sweet',
        splitFromPrevious: true,
        chords: [{ chord: 'D', pos: 0 }],
      },
    ])
  })

  it('round-trips a split through merge without losing text or chord offsets', () => {
    const split = splitLyricLine(lyricLine, 14)
    expect(split).not.toBeNull()
    expect(mergeLyricLines(split![0], split![1])).toEqual(lyricLine)
  })

  it('keeps the merge marker when a previously split line is split again', () => {
    const firstSplit = splitLyricLine(lyricLine, 8)
    const secondSplit = splitLyricLine(firstSplit![1], 6)
    expect(secondSplit?.[0].splitFromPrevious).toBe(true)
    expect(secondSplit?.[1].splitFromPrevious).toBe(true)
  })

  it('rejects invalid boundaries and non-lyric lines', () => {
    expect(splitLyricLine(lyricLine, 9)).toBeNull()
    expect(splitLyricLine({ kind: 'chords-only', chords: ['G'] }, 0)).toBeNull()
  })

  it('updates only the requested section line and can merge it back', () => {
    const sections: Section[] = [{ type: 'Verse', label: 'Verse', lines: [lyricLine] }]
    const splitSections = splitSectionLyricLine(sections, 0, 0, 14)
    expect(splitSections?.[0].lines).toHaveLength(2)
    expect(mergeSectionLyricLineWithPrevious(splitSections!, 0, 1)?.[0].lines).toEqual([lyricLine])
  })
})
