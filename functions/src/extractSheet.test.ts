import { describe, it, expect } from 'vitest'
import {
  bracketedLineToModelLine,
  extractChordsFromSpacedLine,
  transformRawSongsToAppSongs,
  isExpectedSongCount,
  needsSongCountRetry,
  type RawExtractedSong,
} from './extractSheet.js'

describe('expected song count helpers', () => {
  it('accepts only positive whole-number counts', () => {
    expect(isExpectedSongCount(1)).toBe(true)
    expect(isExpectedSongCount(4)).toBe(true)
    expect(isExpectedSongCount(0)).toBe(false)
    expect(isExpectedSongCount(-1)).toBe(false)
    expect(isExpectedSongCount(1.5)).toBe(false)
    expect(isExpectedSongCount('4')).toBe(false)
  })

  it('requests a retry only for an explicit count mismatch', () => {
    expect(needsSongCountRetry(undefined, 3)).toBe(false)
    expect(needsSongCountRetry(4, 4)).toBe(false)
    expect(needsSongCountRetry(4, 3)).toBe(true)
  })
})

describe('bracketedLineToModelLine (Syllable Alignment)', () => {
  it('aligns chords accurately above words without drift (Found in Your hands fullness of joy)', () => {
    const raw = '[Asus]Found in Your [A]hands [Asus]fullness of [A]joy'
    const line = bracketedLineToModelLine('lyric', raw)

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text).toBe('Found in Your hands fullness of joy')
      expect(line.chords).toEqual([
        { pos: 0, chord: 'Asus' }, // on "Found"
        { pos: 14, chord: 'A' },   // on "hands"
        { pos: 20, chord: 'Asus' }, // on "fullness"
        { pos: 32, chord: 'A' },   // on "joy"
      ])
    }
  })

  it('preserves leading whitespace timing where chord plays before lyrics enter', () => {
    const raw = '[F#m7]       Heaven is [E]trembling in awe of Your [D2]wonders'
    const line = bracketedLineToModelLine('lyric', raw)

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text.startsWith('       Heaven')).toBe(true)
      expect(line.chords).toEqual([
        { pos: 0, chord: 'F#m7' }, // at start during timing rest
        { pos: 17, chord: 'E' },   // on "trembling"
        { pos: 42, chord: 'D2' },  // on "wonders"
      ])
    }
  })

  it('handles mid-line and end-of-line chord entries (Chorus)', () => {
    const raw = 'Here in Your Presence we are [A2]un -      [E/G#]done'
    const line = bracketedLineToModelLine('lyric', raw)

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text).toBe('Here in Your Presence we are un -      done')
      expect(line.chords).toEqual([
        { pos: 29, chord: 'A2' },
        { pos: 39, chord: 'E/G#' },
      ])
    }
  })

  it('prevents consecutive chords from colliding even without text between them', () => {
    const raw = 'ev\'ry way [D2] [E]'
    const line = bracketedLineToModelLine('lyric', raw)

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.chords[0].chord).toBe('D2')
      expect(line.chords[1].chord).toBe('E')
      // E must not collide with D2
      expect(line.chords[1].pos).toBeGreaterThan(line.chords[0].pos + line.chords[0].chord.length)
    }
  })

  it('handles chords-only instrumental bar lines', () => {
    const raw = '| A | A | Bm7 | Bm7 |'
    const line = bracketedLineToModelLine('chords-only', raw)

    expect(line.kind).toBe('chords-only')
    if (line.kind === 'chords-only') {
      expect(line.chords).toEqual(['A', 'A', 'Bm7', 'Bm7'])
    }
  })
})

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
})

describe('transformRawSongsToAppSongs', () => {
  it('converts SongSelect songs into app Song schema with correct timing', () => {
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
            type: 'Verse',
            label: 'Verse',
            lines: [
              {
                kind: 'lyric',
                content: '[Asus]Found in Your [A]hands [Asus]fullness of [A]joy',
              },
            ],
          },
          {
            type: 'Pre-Chorus',
            label: 'Pre-Chorus',
            lines: [
              {
                kind: 'lyric',
                content: '[F#m7]       Heaven is [E]trembling in awe of Your [D2]wonders',
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
    expect(song.sections).toHaveLength(2)

    const verseLine = song.sections[0].lines[0]
    if (verseLine.kind === 'lyric') {
      expect(verseLine.text).toBe('Found in Your hands fullness of joy')
      expect(verseLine.chords).toEqual([
        { pos: 0, chord: 'Asus' },
        { pos: 14, chord: 'A' },
        { pos: 20, chord: 'Asus' },
        { pos: 32, chord: 'A' },
      ])
    }

    const preChorusLine = song.sections[1].lines[0]
    if (preChorusLine.kind === 'lyric') {
      expect(preChorusLine.text.startsWith('       Heaven')).toBe(true)
      expect(preChorusLine.chords).toEqual([
        { pos: 0, chord: 'F#m7' },
        { pos: 17, chord: 'E' },
        { pos: 42, chord: 'D2' },
      ])
    }
  })
})
