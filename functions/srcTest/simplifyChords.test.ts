import { describe, expect, it } from 'vitest'
import {
  classifyChordQuality,
  simplifyChord,
  simplifySections,
} from '../src/simplifyChords.js'
import type { Section } from '../src/types.js'

describe('classifyChordQuality', () => {
  it('classifies empty string as major', () => {
    expect(classifyChordQuality('')).toBe('major')
  })

  it('classifies major-family prefixes as major and disambiguates from m', () => {
    expect(classifyChordQuality('maj')).toBe('major')
    expect(classifyChordQuality('maj7')).toBe('major')
    expect(classifyChordQuality('maj9')).toBe('major')
    expect(classifyChordQuality('maj11')).toBe('major')
    expect(classifyChordQuality('maj13')).toBe('major')
    expect(classifyChordQuality('M7')).toBe('major')
    expect(classifyChordQuality('M9')).toBe('major')
  })

  it('classifies minor-family prefixes as minor', () => {
    expect(classifyChordQuality('m')).toBe('minor')
    expect(classifyChordQuality('min')).toBe('minor')
    expect(classifyChordQuality('min7')).toBe('minor')
    expect(classifyChordQuality('m7')).toBe('minor')
    expect(classifyChordQuality('m9')).toBe('minor')
    expect(classifyChordQuality('m11')).toBe('minor')
    expect(classifyChordQuality('m6')).toBe('minor')
    expect(classifyChordQuality('madd9')).toBe('minor')
    expect(classifyChordQuality('m(maj7)')).toBe('minor')
    expect(classifyChordQuality('mMaj7')).toBe('minor')
    expect(classifyChordQuality('-7')).toBe('minor')
  })

  it('classifies diminished and half-diminished as minor', () => {
    expect(classifyChordQuality('dim')).toBe('minor')
    expect(classifyChordQuality('dim7')).toBe('minor')
    expect(classifyChordQuality('°')).toBe('minor')
    expect(classifyChordQuality('°7')).toBe('minor')
    expect(classifyChordQuality('ø')).toBe('minor')
    expect(classifyChordQuality('ø7')).toBe('minor')
    expect(classifyChordQuality('m7b5')).toBe('minor')
  })

  it('classifies augmented, suspended, power, and dominant as major', () => {
    expect(classifyChordQuality('aug')).toBe('major')
    expect(classifyChordQuality('aug7')).toBe('major')
    expect(classifyChordQuality('+')).toBe('major')
    expect(classifyChordQuality('sus2')).toBe('major')
    expect(classifyChordQuality('sus4')).toBe('major')
    expect(classifyChordQuality('5')).toBe('major')
    expect(classifyChordQuality('7')).toBe('major')
    expect(classifyChordQuality('9')).toBe('major')
    expect(classifyChordQuality('11')).toBe('major')
    expect(classifyChordQuality('13')).toBe('major')
    expect(classifyChordQuality('add9')).toBe('major')
    expect(classifyChordQuality('7sus4')).toBe('major')
  })
})

describe('simplifyChord', () => {
  it('simplifies major extensions to plain major', () => {
    expect(simplifyChord('Gmaj7')).toEqual({ simplified: 'G', changed: true })
    expect(simplifyChord('Gadd9')).toEqual({ simplified: 'G', changed: true })
    expect(simplifyChord('G7')).toEqual({ simplified: 'G', changed: true })
    expect(simplifyChord('G9')).toEqual({ simplified: 'G', changed: true })
  })

  it('simplifies dominant and suspended chords to plain major', () => {
    expect(simplifyChord('D7')).toEqual({ simplified: 'D', changed: true })
    expect(simplifyChord('Dsus2')).toEqual({ simplified: 'D', changed: true })
    expect(simplifyChord('Dsus4')).toEqual({ simplified: 'D', changed: true })
  })

  it('simplifies minor extensions to plain minor', () => {
    expect(simplifyChord('Em7')).toEqual({ simplified: 'Em', changed: true })
    expect(simplifyChord('Em9')).toEqual({ simplified: 'Em', changed: true })
    expect(simplifyChord('Em11')).toEqual({ simplified: 'Em', changed: true })
    expect(simplifyChord('Am7')).toEqual({ simplified: 'Am', changed: true })
    expect(simplifyChord('Am6')).toEqual({ simplified: 'Am', changed: true })
    expect(simplifyChord('Am9')).toEqual({ simplified: 'Am', changed: true })
  })

  it('simplifies augmented chords to plain major', () => {
    expect(simplifyChord('Cmaj7')).toEqual({ simplified: 'C', changed: true })
    expect(simplifyChord('Cadd9')).toEqual({ simplified: 'C', changed: true })
    expect(simplifyChord('Caug')).toEqual({ simplified: 'C', changed: true })
    expect(simplifyChord('Caug7')).toEqual({ simplified: 'C', changed: true })
    expect(simplifyChord('C+')).toEqual({ simplified: 'C', changed: true })
  })

  it('simplifies diminished and half-diminished chords to plain minor', () => {
    expect(simplifyChord('Bm7')).toEqual({ simplified: 'Bm', changed: true })
    expect(simplifyChord('Bm7b5')).toEqual({ simplified: 'Bm', changed: true })
    expect(simplifyChord('Bdim')).toEqual({ simplified: 'Bm', changed: true })
    expect(simplifyChord('Bdim7')).toEqual({ simplified: 'Bm', changed: true })
    expect(simplifyChord('Bø')).toEqual({ simplified: 'Bm', changed: true })
    expect(simplifyChord('B°')).toEqual({ simplified: 'Bm', changed: true })
  })

  it('removes slash bass notes', () => {
    expect(simplifyChord('G/B')).toEqual({ simplified: 'G', changed: true })
    expect(simplifyChord('D/F#')).toEqual({ simplified: 'D', changed: true })
    expect(simplifyChord('C/E')).toEqual({ simplified: 'C', changed: true })
    expect(simplifyChord('Am/G')).toEqual({ simplified: 'Am', changed: true })
    expect(simplifyChord('Bm7b5/F')).toEqual({ simplified: 'Bm', changed: true })
  })

  it('simplifies power chords to plain major', () => {
    expect(simplifyChord('G5')).toEqual({ simplified: 'G', changed: true })
    expect(simplifyChord('D5')).toEqual({ simplified: 'D', changed: true })
  })

  it('leaves already simple major and minor chords unchanged with changed: false', () => {
    expect(simplifyChord('G')).toEqual({ simplified: 'G', changed: false })
    expect(simplifyChord('D')).toEqual({ simplified: 'D', changed: false })
    expect(simplifyChord('Em')).toEqual({ simplified: 'Em', changed: false })
    expect(simplifyChord('C')).toEqual({ simplified: 'C', changed: false })
    expect(simplifyChord('Bm')).toEqual({ simplified: 'Bm', changed: false })
    expect(simplifyChord('Am')).toEqual({ simplified: 'Am', changed: false })
  })

  it('preserves root spelling including sharps and flats', () => {
    expect(simplifyChord('F#maj7')).toEqual({ simplified: 'F#', changed: true })
    expect(simplifyChord('F#m7')).toEqual({ simplified: 'F#m', changed: true })
    expect(simplifyChord('Bbadd9')).toEqual({ simplified: 'Bb', changed: true })
    expect(simplifyChord('Bbm7')).toEqual({ simplified: 'Bbm', changed: true })
    expect(simplifyChord('C#m7b5')).toEqual({ simplified: 'C#m', changed: true })
    expect(simplifyChord('Eb/G')).toEqual({ simplified: 'Eb', changed: true })
    expect(simplifyChord('F#')).toEqual({ simplified: 'F#', changed: false })
    expect(simplifyChord('Bb')).toEqual({ simplified: 'Bb', changed: false })
    expect(simplifyChord('Bbm')).toEqual({ simplified: 'Bbm', changed: false })
  })

  it('preserves non-chords, N.C., and unsupported notation unchanged', () => {
    expect(simplifyChord('N.C.')).toEqual({ simplified: 'N.C.', changed: false })
    expect(simplifyChord('(intro)')).toEqual({ simplified: '(intro)', changed: false })
    expect(simplifyChord('riff')).toEqual({ simplified: 'riff', changed: false })
  })
})

describe('simplifySections', () => {
  it('simplifies sections while preserving layout, split markers, and tab lines', () => {
    const originalSections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          {
            kind: 'lyric',
            text: 'Amazing grace how sweet the sound',
            chords: [
              { pos: 0, chord: 'Gadd9' },
              { pos: 14, chord: 'Cmaj7/E' },
              { pos: 25, chord: 'G' },
            ],
            splitFromPrevious: true,
          },
          {
            kind: 'chords-only',
            chords: ['Dsus4', 'D7', 'Em7', 'Bm7b5'],
          },
          {
            kind: 'tab',
            raw: 'e|---0-2-3---|\nB|-----------|',
          },
        ],
      },
    ]

    // Create deep copy snapshot to verify immutability
    const snapshotBefore = JSON.parse(JSON.stringify(originalSections))

    const { sections, changedCount } = simplifySections(originalSections)

    // Gadd9 (1), Cmaj7/E (2), Dsus4 (3), D7 (4), Em7 (5), Bm7b5 (6)
    expect(changedCount).toBe(6)

    // Check transformed section
    expect(sections[0].type).toBe('Verse')
    expect(sections[0].label).toBe('Verse 1')

    const line0 = sections[0].lines[0]
    expect(line0.kind).toBe('lyric')
    if (line0.kind === 'lyric') {
      expect(line0.text).toBe('Amazing grace how sweet the sound')
      expect(line0.splitFromPrevious).toBe(true)
      expect(line0.chords).toEqual([
        { pos: 0, chord: 'G' },
        { pos: 14, chord: 'C' },
        { pos: 25, chord: 'G' },
      ])
    }

    const line1 = sections[0].lines[1]
    expect(line1.kind).toBe('chords-only')
    if (line1.kind === 'chords-only') {
      expect(line1.chords).toEqual(['D', 'D', 'Em', 'Bm'])
    }

    const line2 = sections[0].lines[2]
    expect(line2).toEqual({
      kind: 'tab',
      raw: 'e|---0-2-3---|\nB|-----------|',
    })

    // Assert that originalSections was NEVER mutated
    expect(originalSections).toEqual(snapshotBefore)
    expect(sections).not.toBe(originalSections)
    expect(sections[0].lines).not.toBe(originalSections[0].lines)
  })

  it('returns changedCount: 0 when sections already contain plain chords', () => {
    const plainSections: Section[] = [
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [
          {
            kind: 'lyric',
            text: 'I once was lost',
            chords: [
              { pos: 0, chord: 'G' },
              { pos: 7, chord: 'C' },
              { pos: 11, chord: 'Em' },
              { pos: 14, chord: 'D' },
            ],
          },
        ],
      },
    ]

    const { sections, changedCount } = simplifySections(plainSections)
    expect(changedCount).toBe(0)
    expect(sections).toEqual(plainSections)
  })
})
