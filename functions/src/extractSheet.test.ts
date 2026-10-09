import { describe, it, expect } from 'vitest'
import {
  bracketedLineToModelLine,
  extractChordsFromSpacedLine,
  rawLineToModelLine,
  transformRawSongsToAppSongs,
  type RawExtractedSong,
} from './extractSheet.js'

describe('extractChordsFromSpacedLine', () => {
  it('extracts chords with exact character offsets from spaced line', () => {
    const chordLine = 'F#m7           E                                 D2'
    const chords = extractChordsFromSpacedLine(chordLine)

    expect(chords).toEqual([
      { pos: 0, chord: 'F#m7' },
      { pos: 15, chord: 'E' },
      { pos: 49, chord: 'D2' },
    ])
  })

  it('preserves multiple chords spaced across phrase', () => {
    const chordLine = 'Asus           A         Asus          A'
    const chords = extractChordsFromSpacedLine(chordLine)

    expect(chords).toEqual([
      { pos: 0, chord: 'Asus' },
      { pos: 15, chord: 'A' },
      { pos: 25, chord: 'Asus' },
      { pos: 39, chord: 'A' },
    ])
  })

  it('handles slash chords and parenthesized chords', () => {
    const chordLine = 'F#m       F#m/E   D       A/C#        (D2)'
    const chords = extractChordsFromSpacedLine(chordLine)

    expect(chords).toEqual([
      { pos: 0, chord: 'F#m' },
      { pos: 10, chord: 'F#m/E' },
      { pos: 18, chord: 'D' },
      { pos: 26, chord: 'A/C#' },
      { pos: 39, chord: 'D2' },
    ])
  })
})

describe('rawLineToModelLine', () => {
  it('preserves leading whitespace timing where chord plays before lyrics enter', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      chordLine: 'F#m7           E                                 D2',
      lyricLine: '       Heaven is trembling in awe of Your wonders',
    })

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      // 7 leading spaces are strictly preserved
      expect(line.text.startsWith('       Heaven')).toBe(true)
      expect(line.chords).toEqual([
        { pos: 0, chord: 'F#m7' },
        { pos: 15, chord: 'E' },
        { pos: 49, chord: 'D2' },
      ])
    }
  })

  it('handles indented chords later in lyric line', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      chordLine: '               A2                  E/G#',
      lyricLine: 'Here in Your Presence we are un -      done',
    })

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text).toBe('Here in Your Presence we are un -      done')
      expect(line.chords).toEqual([
        { pos: 15, chord: 'A2' },
        { pos: 35, chord: 'E/G#' },
      ])
    }
  })

  it('handles chords-only instrumental bar lines', () => {
    const line = rawLineToModelLine({
      kind: 'chords-only',
      chordLine: '| A     | A     | Bm7     | Bm7   |',
    })

    expect(line.kind).toBe('chords-only')
    if (line.kind === 'chords-only') {
      expect(line.chords).toEqual(['A', 'A', 'Bm7', 'Bm7'])
    }
  })
})

describe('bracketedLineToModelLine', () => {
  it('parses fallback bracketed format correctly', () => {
    const raw = '[G]Amazing [C/E]grace how [G]sweet the [D]sound'
    const line = bracketedLineToModelLine('lyric', raw)

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text).toBe('Amazing grace how sweet the sound')
      expect(line.chords).toEqual([
        { pos: 0, chord: 'G' },
        { pos: 8, chord: 'C/E' },
        { pos: 18, chord: 'G' },
        { pos: 28, chord: 'D' },
      ])
    }
  })
})

describe('transformRawSongsToAppSongs', () => {
  it('converts spaced SongSelect lines into app Song schema', () => {
    const rawSongs: RawExtractedSong[] = [
      {
        title: 'Here In Your Presence',
        artist: 'Jon Egan',
        originalKey: 'A',
        tempo: '47',
        timeSignature: '6/8',
        ccliNumber: '4882707',
        sections: [
          {
            type: 'Pre-Chorus',
            label: 'Pre-Chorus',
            lines: [
              {
                kind: 'lyric',
                chordLine: 'F#m7           E                                 D2',
                lyricLine: '       Heaven is trembling in awe of Your wonders',
              },
            ],
          },
        ],
      },
    ]

    const songs = transformRawSongsToAppSongs(rawSongs)
    expect(songs).toHaveLength(1)
    const song = songs[0]

    expect(song.title).toBe('Here In Your Presence')
    expect(song.artist).toBe('Jon Egan')
    expect(song.originalKey).toBe('A')
    expect(song.sections).toHaveLength(1)

    const firstLine = song.sections[0].lines[0]
    expect(firstLine.kind).toBe('lyric')
    if (firstLine.kind === 'lyric') {
      expect(firstLine.text.startsWith('       Heaven')).toBe(true)
      expect(firstLine.chords).toEqual([
        { pos: 0, chord: 'F#m7' },
        { pos: 15, chord: 'E' },
        { pos: 49, chord: 'D2' },
      ])
    }
  })
})
