import { describe, it, expect } from 'vitest'
import { formatSetlistLyrics } from './exportLyrics'
import type { Song, Section } from '../types/song'
import type { SessionSongItem } from './sessionStore'

function createMockSong(id: string, title: string, artist: string, sections: Section[]): Song {
  return {
    id,
    title,
    artist,
    sourceUrl: `https://example.com/${id}`,
    sourceSite: 'example.com',
    originalKey: 'G',
    sections,
  }
}

describe('exportLyrics', () => {
  it('formats songs in setlist order with titles and [Section] headers without chords', () => {
    const song1Sections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          {
            kind: 'lyric',
            text: 'You are here moving in our midst',
            chords: [{ chord: 'G', pos: 0 }],
          },
          {
            kind: 'lyric',
            text: 'I worship You I worship You',
            chords: [{ chord: 'C', pos: 0 }],
          },
        ],
      },
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [
          {
            kind: 'lyric',
            text: 'Way maker miracle worker',
            chords: [{ chord: 'D', pos: 0 }],
          },
        ],
      },
    ]

    const song2Sections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          {
            kind: 'lyric',
            text: 'I love You Lord',
            chords: [{ chord: 'C', pos: 0 }],
          },
          {
            kind: 'lyric',
            text: 'For Your mercy never fails me',
            chords: [{ chord: 'G', pos: 0 }],
          },
        ],
      },
    ]

    const song1 = createMockSong('song-1', 'Way Maker', 'Leeland', song1Sections)
    const song2 = createMockSong('song-2', 'Goodness of God', 'Bethel', song2Sections)

    const songsData = new Map<string, Song>([
      [song1.sourceUrl, song1],
      [song2.sourceUrl, song2],
    ])

    const setlist: SessionSongItem[] = [
      { url: song1.sourceUrl, title: song1.title, artist: song1.artist, status: 'ok' },
      { url: song2.sourceUrl, title: song2.title, artist: song2.artist, status: 'ok' },
    ]

    const output = formatSetlistLyrics(setlist, songsData)

    expect(output).toContain('Way Maker')
    expect(output).toContain('[Verse 1]\nYou are here moving in our midst\nI worship You I worship You')
    expect(output).toContain('[Chorus]\nWay maker miracle worker')
    expect(output).toContain('Goodness of God')
    expect(output).toContain('[Verse 1]\nI love You Lord\nFor Your mercy never fails me')

    // Songs must appear in setlist order
    const wayMakerIndex = output.indexOf('Way Maker')
    const goodnessIndex = output.indexOf('Goodness of God')
    expect(wayMakerIndex).toBeLessThan(goodnessIndex)

    // No ChordPlacement or raw chords leaked above lyrics
    expect(output).not.toContain('pos:')
    expect(output).not.toContain('ChordPlacement')
  })

  it('respects musician custom section deletions and reordering (1:1 match)', () => {
    const originalSections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Verse 1 lyrics', chords: [] }],
      },
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [{ kind: 'lyric', text: 'Chorus lyrics', chords: [] }],
      },
      {
        type: 'Outro',
        label: 'Outro',
        lines: [{ kind: 'lyric', text: 'Outro lyrics', chords: [] }],
      },
    ]

    const song = createMockSong('song-1', 'Test Song', 'Artist', originalSections)
    const songsData = new Map<string, Song>([[song.sourceUrl, song]])

    // Musician deleted Outro and moved Chorus before Verse 1
    const customSections: Section[] = [
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [{ kind: 'lyric', text: 'Chorus lyrics', chords: [] }],
      },
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Verse 1 lyrics', chords: [] }],
      },
    ]

    const setlist: SessionSongItem[] = [
      {
        url: song.sourceUrl,
        title: song.title,
        status: 'ok',
        customSections,
      },
    ]

    const output = formatSetlistLyrics(setlist, songsData)

    expect(output).toContain('[Chorus]\nChorus lyrics')
    expect(output).toContain('[Verse 1]\nVerse 1 lyrics')
    expect(output).not.toContain('[Outro]')
    expect(output).not.toContain('Outro lyrics')

    // Chorus must appear before Verse 1 in export as well
    const chorusIdx = output.indexOf('[Chorus]')
    const verseIdx = output.indexOf('[Verse 1]')
    expect(chorusIdx).toBeLessThan(verseIdx)
  })

  it('handles sections without lyric lines (like [Intro] with chords only)', () => {
    const sections: Section[] = [
      {
        type: 'Intro',
        label: 'Intro',
        lines: [{ kind: 'chords-only', chords: ['G', 'C', 'D'] }],
      },
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'First line', chords: [] }],
      },
    ]

    const song = createMockSong('song-1', 'Intro Song', 'Artist', sections)
    const songsData = new Map<string, Song>([[song.sourceUrl, song]])
    const setlist: SessionSongItem[] = [
      { url: song.sourceUrl, title: song.title, status: 'ok' },
    ]

    const output = formatSetlistLyrics(setlist, songsData)
    expect(output).toContain('[Intro]')
    expect(output).toContain('[Verse 1]\nFirst line')
  })

  it('removes duplicate sections with identical lyric content within a song', () => {
    const sections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'This is verse 1', chords: [] }],
      },
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [
          { kind: 'lyric', text: 'This is the chorus', chords: [] },
          { kind: 'lyric', text: 'Sing it loud', chords: [] },
        ],
      },
      {
        type: 'Verse',
        label: 'Verse 2',
        lines: [{ kind: 'lyric', text: 'This is verse 2', chords: [] }],
      },
      {
        type: 'Chorus',
        label: 'Chorus 2',
        lines: [
          { kind: 'lyric', text: 'This is the chorus', chords: [] },
          { kind: 'lyric', text: 'Sing it loud', chords: [] },
        ],
      },
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [
          { kind: 'lyric', text: 'This is the chorus', chords: [] },
          { kind: 'lyric', text: 'Sing it loud', chords: [] },
        ],
      },
      {
        type: 'Outro',
        label: 'Outro',
        lines: [{ kind: 'lyric', text: 'Ending here', chords: [] }],
      },
    ]

    const song = createMockSong('song-dup', 'Duplicate Test Song', 'Artist', sections)
    const songsData = new Map<string, Song>([[song.sourceUrl, song]])
    const setlist: SessionSongItem[] = [
      { url: song.sourceUrl, title: song.title, status: 'ok' },
    ]

    const output = formatSetlistLyrics(setlist, songsData)

    // Chorus should only appear ONCE in the exported lyrics
    const chorusMatches = output.match(/This is the chorus/g)
    expect(chorusMatches).toHaveLength(1)

    expect(output).toContain('[Chorus]\nThis is the chorus\nSing it loud')
    expect(output).toContain('[Verse 1]\nThis is verse 1')
    expect(output).toContain('[Verse 2]\nThis is verse 2')
    expect(output).toContain('[Outro]\nEnding here')
    expect(output).not.toContain('[Chorus 2]')
  })

  it('keeps distinct choruses if lyrics differ between them', () => {
    const sections: Section[] = [
      {
        type: 'Chorus',
        label: 'Chorus 1',
        lines: [{ kind: 'lyric', text: 'First version of chorus', chords: [] }],
      },
      {
        type: 'Chorus',
        label: 'Chorus 2',
        lines: [{ kind: 'lyric', text: 'Second version of chorus with more words', chords: [] }],
      },
    ]

    const song = createMockSong('song-distinct', 'Distinct Song', 'Artist', sections)
    const songsData = new Map<string, Song>([[song.sourceUrl, song]])
    const setlist: SessionSongItem[] = [
      { url: song.sourceUrl, title: song.title, status: 'ok' },
    ]

    const output = formatSetlistLyrics(setlist, songsData)

    expect(output).toContain('[Chorus 1]\nFirst version of chorus')
    expect(output).toContain('[Chorus 2]\nSecond version of chorus with more words')
  })
})
