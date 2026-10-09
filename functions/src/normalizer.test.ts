import { describe, it, expect } from 'vitest'
import {
  detectSectionHeader,
  extractChordsWithPositions,
  normalizeSongText,
  inferKeyFromChords,
  isTabLine,
} from './normalizer.js'

describe('detectSectionHeader', () => {
  it('detects bracketed section headers', () => {
    expect(detectSectionHeader('[Verse 1]')).toEqual({ type: 'Verse', label: 'Verse 1' })
    expect(detectSectionHeader('[Chorus]')).toEqual({ type: 'Chorus', label: 'Chorus' })
    expect(detectSectionHeader('[Pre-Chorus 2]')).toEqual({ type: 'Pre-Chorus', label: 'Pre-Chorus 2' })
    expect(detectSectionHeader('[Bridge]')).toEqual({ type: 'Bridge', label: 'Bridge' })
    expect(detectSectionHeader('[Intro]')).toEqual({ type: 'Intro', label: 'Intro' })
    expect(detectSectionHeader('[Outro]')).toEqual({ type: 'Outro', label: 'Outro' })
  })

  it('detects unbracketed section headers with colons', () => {
    expect(detectSectionHeader('Verse 1:')).toEqual({ type: 'Verse', label: 'Verse 1' })
    expect(detectSectionHeader('Chorus:')).toEqual({ type: 'Chorus', label: 'Chorus' })
    expect(detectSectionHeader('Intro:')).toEqual({ type: 'Intro', label: 'Intro' })
  })

  it('returns null for lyric lines or chords', () => {
    expect(detectSectionHeader('Amazing grace how sweet the sound')).toBeNull()
    expect(detectSectionHeader('G   C   D   G')).toBeNull()
  })
})

describe('isTabLine', () => {
  it('detects standard guitar tab lines', () => {
    expect(isTabLine('e|---0--1--3---|')).toBe(true)
    expect(isTabLine('B|---1---------|')).toBe(true)
    expect(isTabLine('|--3--2--0--|')).toBe(true)
  })

  it('rejects regular lyrics or chords', () => {
    expect(isTabLine('G   D/F#   Em7')).toBe(false)
    expect(isTabLine('Hello darkness my old friend')).toBe(false)
  })
})

describe('extractChordsWithPositions', () => {
  it('extracts chord symbols with character offsets', () => {
    const chordLine = 'G       C        D'
    const chords = extractChordsWithPositions(chordLine)
    expect(chords).toEqual([
      { pos: 0, chord: 'G' },
      { pos: 8, chord: 'C' },
      { pos: 17, chord: 'D' },
    ])
  })
})

describe('normalizeSongText', () => {
  it('converts chord-over-lyric text into structured sections', () => {
    const raw = `
[Verse 1]
G        C
Amazing grace how sweet
D         G
That saved a wretch

[Chorus]
C   G
My chains are gone
D
I've been set free
`
    const sections = normalizeSongText(raw)
    expect(sections.length).toBe(2)
    expect(sections[0].type).toBe('Verse')
    expect(sections[0].label).toBe('Verse 1')
    expect(sections[0].lines.length).toBe(2)

    const line1 = sections[0].lines[0]
    expect(line1.kind).toBe('lyric')
    if (line1.kind === 'lyric') {
      expect(line1.text).toBe('Amazing grace how sweet')
      expect(line1.chords).toEqual([
        { pos: 0, chord: 'G' },
        { pos: 9, chord: 'C' },
      ])
    }
  })

  it('handles chords-only lines and tabs', () => {
    const raw = `
[Intro]
G  C  D  G

e|---0-1-3---|
`
    const sections = normalizeSongText(raw)
    expect(sections.length).toBe(1)
    expect(sections[0].lines[0]).toEqual({
      kind: 'chords-only',
      chords: ['G', 'C', 'D', 'G'],
    })
    expect(sections[0].lines[1]).toEqual({
      kind: 'tab',
      raw: 'e|---0-1-3---|',
    })
  })
})

describe('inferKeyFromChords', () => {
  it('infers key from chord occurrences and first/last chord', () => {
    const raw = `
[Verse 1]
G        C
Amazing grace how sweet
D         G
That saved a wretch
`
    const sections = normalizeSongText(raw)
    const key = inferKeyFromChords(sections)
    expect(key).toBe('G')
  })
})

describe('deduplication of lines', () => {
  it('removes duplicate contiguous lines with identical chords', () => {
    const raw = `
[Chorus]
C        G
Hallelujah
C        G
Hallelujah
`
    const sections = normalizeSongText(raw)
    expect(sections[0].lines.length).toBe(1)
    expect(sections[0].lines[0]).toEqual({
      kind: 'lyric',
      text: 'Hallelujah',
      chords: [
        { pos: 0, chord: 'C' },
        { pos: 9, chord: 'G' },
      ],
    })
  })

  it('preserves duplicate lyrics that have DIFFERENT chords', () => {
    const raw = `
[Chorus]
C        G
Hallelujah
Am       F
Hallelujah
`
    const sections = normalizeSongText(raw)
    expect(sections[0].lines.length).toBe(2)
    expect(sections[0].lines[0]).toEqual({
      kind: 'lyric',
      text: 'Hallelujah',
      chords: [
        { pos: 0, chord: 'C' },
        { pos: 9, chord: 'G' },
      ],
    })
    expect(sections[0].lines[1]).toEqual({
      kind: 'lyric',
      text: 'Hallelujah',
      chords: [
        { pos: 0, chord: 'Am' },
        { pos: 9, chord: 'F' },
      ],
    })
  })
})
