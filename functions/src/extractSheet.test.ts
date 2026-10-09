import { describe, it, expect } from 'vitest'
import {
  bracketedLineToModelLine,
  transformRawSongsToAppSongs,
  type RawExtractedSong,
} from './extractSheet.js'

describe('bracketedLineToModelLine', () => {
  it('parses chords above syllables accurately', () => {
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

  it('handles lyric lines with no chords', () => {
    const raw = 'That saved a wretch like me'
    const line = bracketedLineToModelLine('lyric', raw)

    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text).toBe('That saved a wretch like me')
      expect(line.chords).toEqual([])
    }
  })

  it('handles chords-only lines with slash bars', () => {
    const raw = '| G / / / | C/E / / / | Em7 / D / |'
    const line = bracketedLineToModelLine('chords-only', raw)

    expect(line.kind).toBe('chords-only')
    if (line.kind === 'chords-only') {
      expect(line.chords).toEqual(['G', 'C/E', 'Em7', 'D'])
    }
  })
})

describe('transformRawSongsToAppSongs', () => {
  it('converts raw Gemini response into app Song schema', () => {
    const rawSongs: RawExtractedSong[] = [
      {
        title: 'Goodness of God',
        artist: 'Jenn Johnson, Ed Cash',
        originalKey: 'Ab',
        tempo: '68 bpm',
        timeSignature: '4/4',
        ccliNumber: '7117726',
        sections: [
          {
            type: 'Verse',
            label: 'Verse 1',
            lines: [
              {
                kind: 'lyric',
                content: 'I love You [Ab]Lord for Your [Db]mercy never [Ab]fails me',
              },
            ],
          },
          {
            type: 'Chorus',
            label: 'Chorus',
            lines: [
              {
                kind: 'lyric',
                content: 'All my [Db]life You have been [Ab]faithful',
              },
            ],
          },
        ],
      },
    ]

    const songs = transformRawSongsToAppSongs(rawSongs)
    expect(songs).toHaveLength(1)
    const song = songs[0]

    expect(song.title).toBe('Goodness of God')
    expect(song.artist).toBe('Jenn Johnson, Ed Cash')
    expect(song.originalKey).toBe('Ab')
    expect(song.sections).toHaveLength(2)
    expect(song.sections[0].type).toBe('Verse')
    expect(song.sections[0].label).toBe('Verse 1')

    const firstLine = song.sections[0].lines[0]
    expect(firstLine.kind).toBe('lyric')
    if (firstLine.kind === 'lyric') {
      expect(firstLine.text).toBe('I love You Lord for Your mercy never fails me')
      expect(firstLine.chords).toEqual([
        { pos: 11, chord: 'Ab' },
        { pos: 25, chord: 'Db' },
        { pos: 37, chord: 'Ab' },
      ])
    }
  })
})
