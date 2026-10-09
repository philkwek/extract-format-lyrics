import { describe, expect, it } from 'vitest'
import { isChord, isChordLine, noteToIndex, parseChord } from './chords'

describe('noteToIndex', () => {
  it('maps natural, sharp and flat notes', () => {
    expect(noteToIndex('C')).toBe(0)
    expect(noteToIndex('F#')).toBe(6)
    expect(noteToIndex('Bb')).toBe(10)
    expect(noteToIndex('Cb')).toBe(11)
    expect(noteToIndex('H')).toBeNull()
  })
})

describe('parseChord', () => {
  it('parses simple chords', () => {
    expect(parseChord('G')).toMatchObject({ root: 7, quality: '', bass: null })
    expect(parseChord('Am')).toMatchObject({ root: 9, quality: 'm' })
  })

  it('parses extended chords and slash chords', () => {
    expect(parseChord('F#m7b5/C')).toMatchObject({ root: 6, quality: 'm7b5', bass: 0 })
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, quality: 'maj7' })
    expect(parseChord('Dsus4')).toMatchObject({ root: 2, quality: 'sus4' })
    expect(parseChord('C(add9)')).toMatchObject({ root: 0, quality: '(add9)' })
    expect(parseChord('G/B')).toMatchObject({ root: 7, bass: 11 })
  })

  it('rejects words and other non-chords', () => {
    for (const t of ['Hello', 'Amazing', 'Chorus', 'Gone', 'a', '', 'Em7x', 'Bad']) {
      expect(isChord(t)).toBe(false)
    }
  })
})

describe('isChordLine', () => {
  it('detects chord-only lines', () => {
    expect(isChordLine('G   D   Em  C')).toBe(true)
    expect(isChordLine('| Am | F | C | G |')).toBe(true)
  })

  it('rejects lyric lines', () => {
    expect(isChordLine('Amazing grace how sweet the sound')).toBe(false)
    expect(isChordLine('')).toBe(false)
  })
})
