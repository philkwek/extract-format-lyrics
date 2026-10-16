import { describe, it, expect } from 'vitest'
import {
  allocateColumnWidths,
  getColumnDisplayWidths,
  getLineDisplayWidth,
  getSectionDisplayWidth,
  getSectionWeight,
  partitionSections,
} from './songLayout'
import type { Section } from '../types/song'

function makeMockSection(label: string, lineCount: number): Section {
  return {
    type: 'Verse',
    label,
    lines: Array.from({ length: lineCount }, (_, i) => ({
      kind: 'lyric',
      text: `Line text ${i + 1}`,
      chords: [{ chord: 'G', pos: 0 }],
    })),
  }
}

describe('songLayout - partitionSections', () => {
  it('measures lyric segments using the wider of their chord or lyric content', () => {
    expect(
      getLineDisplayWidth({
        kind: 'lyric',
        text: 'go now',
        chords: [{ chord: 'Cmaj7', pos: 3 }],
      })
    ).toBe(9)
  })

  it('measures chord-only and tab lines as their preformatted content', () => {
    expect(getLineDisplayWidth({ kind: 'chords-only', chords: ['G', 'Cmaj7', 'D'] })).toBe(13)
    expect(getLineDisplayWidth({ kind: 'tab', raw: 'e|---0---|' })).toBe(10)
  })

  it('uses the widest section text in each non-empty column', () => {
    const shortSection = makeMockSection('Verse', 1)
    const longSection: Section = {
      type: 'Chorus',
      label: 'Long section heading',
      lines: [{ kind: 'lyric', text: 'A much longer lyric line', chords: [] }],
    }

    expect(getSectionDisplayWidth(shortSection)).toBe('Line text 1'.length)
    expect(getSectionDisplayWidth(longSection)).toBe('A much longer lyric line'.length)
    expect(
      getColumnDisplayWidths([
        [{ section: shortSection, originalIndex: 0 }],
        [{ section: longSection, originalIndex: 1 }],
        [],
      ])
    ).toEqual(['Line text 1'.length, 'A much longer lyric line'.length])
  })

  it('allocates narrower columns in full first and caps only the overflowing wide column', () => {
    // Col 1 (30ch) <= 114/3 (38ch) -> locked at 30ch.
    // Remaining 84ch across Col 2 & 3 -> fair share 42ch.
    // Col 2 (42ch) <= 42ch -> locked at 42ch.
    // Col 3 (60ch) gets the remaining 42ch so only Col 3 overflows.
    expect(allocateColumnWidths([30, 42, 60], 114)).toEqual([30, 42, 42])
  })

  it('splits remaining width evenly between multiple overflowing columns after fitting narrow column', () => {
    expect(allocateColumnWidths([24, 55, 60], 104)).toEqual([24, 40, 40])
  })

  it('allocates equal shares when every column exceeds its fair share', () => {
    expect(allocateColumnWidths([50, 60, 70], 120)).toEqual([40, 40, 40])
  })

  it('gives every column its full needed width plus even surplus when all columns fit', () => {
    expect(allocateColumnWidths([25, 35, 40], 130)).toEqual([35, 45, 50])
  })

  it('returns single column when numColumns is 1', () => {
    const sections = [
      makeMockSection('Intro', 4),
      makeMockSection('Verse 1', 8),
      makeMockSection('Chorus', 6),
    ]
    const result = partitionSections(sections, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(3)
    expect(result[0].map((item) => item.section.label)).toEqual(['Intro', 'Verse 1', 'Chorus'])
    expect(result[0].map((item) => item.originalIndex)).toEqual([0, 1, 2])
  })

  it('handles empty sections list', () => {
    const result = partitionSections([], 3)
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(0)
  })

  it('handles fewer sections than columns (e.g. 2 sections with 3 columns)', () => {
    const sections = [makeMockSection('Verse 1', 4), makeMockSection('Chorus', 6)]
    const result = partitionSections(sections, 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toHaveLength(1)
    expect(result[1]).toHaveLength(1)
    expect(result[2]).toHaveLength(0)
    expect(result[0][0].originalIndex).toBe(0)
    expect(result[1][0].originalIndex).toBe(1)
  })

  it('partitions 3 sections into 3 columns (1 per column)', () => {
    const sections = [
      makeMockSection('Intro', 4),
      makeMockSection('Verse 1', 6),
      makeMockSection('Chorus', 6),
    ]
    const result = partitionSections(sections, 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toHaveLength(1)
    expect(result[1]).toHaveLength(1)
    expect(result[2]).toHaveLength(1)
    expect(result[0][0].section.label).toBe('Intro')
    expect(result[1][0].section.label).toBe('Verse 1')
    expect(result[2][0].section.label).toBe('Chorus')
  })

  it('partitions 4 sections across 3 columns so NO column is empty', () => {
    const sections = [
      makeMockSection('Intro', 4),
      makeMockSection('Verse 1', 8),
      makeMockSection('Chorus', 8),
      makeMockSection('Outro', 4),
    ]
    const result = partitionSections(sections, 3)
    expect(result).toHaveLength(3)
    // Every column must have at least 1 section!
    expect(result[0].length).toBeGreaterThan(0)
    expect(result[1].length).toBeGreaterThan(0)
    expect(result[2].length).toBeGreaterThan(0)

    // Total sections must equal 4
    const totalCount = result[0].length + result[1].length + result[2].length
    expect(totalCount).toBe(4)

    // Preserves original indices and chronological order
    expect(result[0][0].originalIndex).toBe(0)
    expect(result[2][result[2].length - 1].originalIndex).toBe(3)
  })

  it('maintains balanced distribution when sections are deleted down to 4 or 5', () => {
    // Simulating song on iPad after user deletes several sections
    const sections = [
      makeMockSection('Verse 1', 6),
      makeMockSection('Chorus 1', 8),
      makeMockSection('Verse 2', 6),
      makeMockSection('Chorus 2', 8),
      makeMockSection('Bridge', 6),
    ]
    const result = partitionSections(sections, 3)
    expect(result).toHaveLength(3)
    expect(result[0].length).toBeGreaterThan(0)
    expect(result[1].length).toBeGreaterThan(0)
    expect(result[2].length).toBeGreaterThan(0)

    // Column 3 must NOT be left empty!
    expect(result[2].length).toBeGreaterThanOrEqual(1)
  })

  it('partitions 2 columns evenly', () => {
    const sections = [
      makeMockSection('Verse 1', 6),
      makeMockSection('Chorus', 8),
      makeMockSection('Verse 2', 6),
      makeMockSection('Outro', 4),
    ]
    const result = partitionSections(sections, 2)
    expect(result).toHaveLength(2)
    expect(result[0].length).toBe(2)
    expect(result[1].length).toBe(2)
    expect(result[0].map((i) => i.originalIndex)).toEqual([0, 1])
    expect(result[1].map((i) => i.originalIndex)).toEqual([2, 3])
  })

  it('correctly calculates section weight considering chords and lines', () => {
    const section: Section = {
      type: 'Verse',
      label: 'Verse',
      lines: [
        { kind: 'lyric', text: 'Amazing grace', chords: [{ chord: 'G', pos: 0 }] }, // 2
        { kind: 'lyric', text: 'How sweet the sound', chords: [] }, // 1
        { kind: 'chords-only', chords: ['G', 'C'] }, // 1.5
        { kind: 'tab', raw: 'e|---0---|' }, // 1
      ],
    }
    // Base 2.5 + 2 + 1 + 1.5 + 1 = 8
    expect(getSectionWeight(section)).toBe(8)
  })
})
