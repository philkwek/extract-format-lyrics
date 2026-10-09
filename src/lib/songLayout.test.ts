import { describe, it, expect } from 'vitest'
import { partitionSections, getSectionWeight } from './songLayout'
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
