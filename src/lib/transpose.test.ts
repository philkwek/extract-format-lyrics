import { describe, expect, it } from 'vitest'
import { keyUsesFlats, parseKey, transposeChord, transposeSong } from './transpose'
import type { Song } from '../types/song'

describe('transposeChord', () => {
  it('shifts simple chords', () => {
    expect(transposeChord('G', 2, false)).toBe('A')
    expect(transposeChord('Am', 3, false)).toBe('Cm')
    expect(transposeChord('B', 1, false)).toBe('C')
  })

  it('shifts slash and extended chords', () => {
    expect(transposeChord('F#m7b5/C', 2, false)).toBe('G#m7b5/D')
    expect(transposeChord('G/B', 2, false)).toBe('A/C#')
  })

  it('spells with flats when requested', () => {
    expect(transposeChord('G', -2, true)).toBe('F')
    expect(transposeChord('C', 10, true)).toBe('Bb')
    expect(transposeChord('C', 10, false)).toBe('A#')
  })

  it('leaves non-chords untouched', () => {
    expect(transposeChord('N.C.', 5, false)).toBe('N.C.')
    expect(transposeChord('Hello', 5, false)).toBe('Hello')
  })

  it('round-trips for all 12 shifts', () => {
    const chords = ['C', 'Dm7', 'F#m7b5/C', 'Bbmaj7', 'G/B', 'Asus4']
    for (let n = 0; n < 12; n++) {
      for (const c of chords) {
        const there = transposeChord(c, n, false)
        const back = transposeChord(there, -n, false)
        const original = parseKeyless(c)
        expect(parseKeyless(back)).toEqual(original)
      }
    }
  })
})

/** Normalises enharmonic spelling by transposing by 0 with sharps. */
function parseKeyless(c: string): string {
  return transposeChord(c, 0, false)
}

describe('keys', () => {
  it('parses keys', () => {
    expect(parseKey('G')).toMatchObject({ root: 7, minor: false })
    expect(parseKey('Bbm')).toMatchObject({ root: 10, minor: true })
    expect(parseKey('nope')).toBeNull()
  })

  it('chooses flat or sharp spelling', () => {
    expect(keyUsesFlats('F')).toBe(true)
    expect(keyUsesFlats('Bb')).toBe(true)
    expect(keyUsesFlats('Dm')).toBe(true)
    expect(keyUsesFlats('G')).toBe(false)
    expect(keyUsesFlats('F#')).toBe(false)
    expect(keyUsesFlats('Em')).toBe(false)
  })
})

describe('transposeSong', () => {
  const song: Song = {
    id: '1',
    title: 't',
    artist: 'a',
    sourceUrl: 'u',
    sourceSite: 's',
    originalKey: 'G',
    sections: [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          { kind: 'lyric', text: 'Hello there', chords: [{ pos: 0, chord: 'G' }, { pos: 6, chord: 'D/F#' }] },
          { kind: 'chords-only', chords: ['Em', 'C'] },
          { kind: 'tab', raw: 'e|--0--|' },
        ],
      },
    ],
  }

  it('transposes every chord and keeps tabs and text intact', () => {
    const out = transposeSong(song, -2, 'F')
    const lines = out.sections[0].lines
    expect(lines[0]).toMatchObject({
      text: 'Hello there',
      chords: [{ pos: 0, chord: 'F' }, { pos: 6, chord: 'C/E' }],
    })
    expect(lines[1]).toEqual({ kind: 'chords-only', chords: ['Dm', 'Bb'] })
    expect(lines[2]).toEqual({ kind: 'tab', raw: 'e|--0--|' })
  })

  it('does not mutate the original', () => {
    transposeSong(song, 5, 'C')
    expect(song.sections[0].lines[1]).toEqual({ kind: 'chords-only', chords: ['Em', 'C'] })
  })
})
