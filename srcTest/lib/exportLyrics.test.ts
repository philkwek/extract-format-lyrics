import { describe, it, expect } from 'vitest'
import {
  formatSetlistLyrics,
  extractSongLyrics,
  buildSharedLyricsPayload,
  cleanLyricLine,
  ShareLyricsError,
} from '../../src/lib/exportLyrics'
import type { Song, Section } from '../../src/types/song'

import type { SessionSongItem } from '../../src/lib/sessionStore'

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

  it('filters out sections without lyric lines (like [Intro] with chords only)', () => {
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
    expect(output).not.toContain('[Intro]')
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

describe('structured lyrics extraction and SharedLyricsPayload', () => {
  it('extracts structured sections without chords, tabs, or metadata', () => {
    const sections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          { kind: 'lyric', text: 'Amazing grace how sweet the sound', chords: [{ chord: 'G', pos: 0 }] },
          { kind: 'chords-only', chords: ['G', 'C'] },
          { kind: 'lyric', text: 'That saved a wretch like me', chords: [{ chord: 'D', pos: 5 }] },
          { kind: 'tab', raw: 'e|---0---|' },
        ],
      },
    ]

    const song = createMockSong('song-1', 'Amazing Grace', 'John Newton', sections)
    const item: SessionSongItem = { entryId: 'entry-1', url: song.sourceUrl, status: 'ok' }

    const structured = extractSongLyrics(item, song)
    expect(structured.entryId).toBe('entry-1')
    expect(structured.title).toBe('Amazing Grace')
    expect(structured.sections).toHaveLength(1)
    expect(structured.sections[0].label).toBe('Verse 1')
    expect(structured.sections[0].lines).toEqual([
      'Amazing grace how sweet the sound',
      'That saved a wretch like me',
    ])
  })

  it('preserves internal blank lines while trimming leading/trailing blank lines', () => {
    const sections: Section[] = [
      {
        type: 'Verse',
        label: '[Verse 1]',
        lines: [
          { kind: 'lyric', text: '   ', chords: [] },
          { kind: 'lyric', text: 'Line one', chords: [] },
          { kind: 'lyric', text: '', chords: [] },
          { kind: 'lyric', text: 'Line two after blank', chords: [] },
          { kind: 'lyric', text: '   ', chords: [] },
        ],
      },
    ]

    const song = createMockSong('song-1', 'Song with Blanks', 'Artist', sections)
    const item: SessionSongItem = { entryId: 'entry-1', url: song.sourceUrl, status: 'ok' }

    const structured = extractSongLyrics(item, song)
    expect(structured.sections[0].label).toBe('Verse 1')
    expect(structured.sections[0].lines).toEqual(['Line one', '', 'Line two after blank'])
  })

  it('respects simplification selection and custom simplified sections', () => {
    const normalSections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse',
        lines: [{ kind: 'lyric', text: 'Standard verse lyrics', chords: [{ chord: 'F#m7b5', pos: 0 }] }],
      },
    ]
    const simplifiedSections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse (Simple)',
        lines: [{ kind: 'lyric', text: 'Simplified verse lyrics', chords: [{ chord: 'Am', pos: 0 }] }],
      },
    ]

    const song: Song = {
      ...createMockSong('song-simp', 'Simple Song', 'Artist', normalSections),
      simplifiedSections,
    }

    const normalItem: SessionSongItem = { entryId: 'normal-1', url: song.sourceUrl, status: 'ok', simplified: false }
    const simpleItem: SessionSongItem = { entryId: 'simple-1', url: song.sourceUrl, status: 'ok', simplified: true }

    const normalResult = extractSongLyrics(normalItem, song, false)
    expect(normalResult.sections[0].label).toBe('Verse')
    expect(normalResult.sections[0].lines).toEqual(['Standard verse lyrics'])

    const simpleResult = extractSongLyrics(simpleItem, song, true)
    expect(simpleResult.sections[0].label).toBe('Verse (Simple)')
    expect(simpleResult.sections[0].lines).toEqual(['Simplified verse lyrics'])
  })

  it('preserves empty custom arrangements as empty sections array', () => {
    const sections: Section[] = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Some text', chords: [] }],
      },
    ]
    const song = createMockSong('song-del', 'Empty Song', 'Artist', sections)
    const item: SessionSongItem = {
      entryId: 'entry-empty',
      url: song.sourceUrl,
      status: 'ok',
      customSections: [], // Musician deleted all sections
    }

    const structured = extractSongLyrics(item, song)
    expect(structured.sections).toEqual([])
  })

  it('filters out sections that do not contain any lyrics', () => {
    const sections: Section[] = [
      {
        type: 'Intro',
        label: '[Intro]',
        lines: [{ kind: 'chords-only', chords: ['C', 'G'] }],
      },
      {
        type: 'Instrumental',
        label: 'Instrumental Break',
        lines: [{ kind: 'chords-only', chords: ['Am', 'F'] }],
      },
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Words here', chords: [] }],
      },
      {
        type: 'Other',
        label: 'Interlude',
        lines: [{ kind: 'tab', raw: 'e|---0---|' }],
      },
      {
        type: 'Outro',
        label: 'Outro',
        lines: [
          { kind: 'lyric', text: '   ', chords: [] },
          { kind: 'lyric', text: '', chords: [] },
        ],
      },
    ]
    const song = createMockSong('song-inst', 'Instrumental Song', 'Artist', sections)
    const item: SessionSongItem = { entryId: 'entry-inst', url: song.sourceUrl, status: 'ok' }

    const structured = extractSongLyrics(item, song)
    expect(structured.sections).toHaveLength(1)
    expect(structured.sections[0]).toEqual({ label: 'Verse 1', lines: ['Words here'] })
  })

  it('keeps separate occurrences of the same song in a setlist', () => {
    const sections: Section[] = [
      {
        type: 'Chorus',
        label: 'Chorus',
        lines: [{ kind: 'lyric', text: 'Praise the Lord', chords: [] }],
      },
    ]
    const song = createMockSong('song-repeated', 'Praise', 'Artist', sections)
    const session = {
      name: 'Sunday Service',
      songs: [
        { entryId: 'occurrence-1', url: song.sourceUrl, title: song.title, status: 'ok' as const },
        { entryId: 'occurrence-2', url: song.sourceUrl, title: song.title, status: 'ok' as const },
      ],
    }
    const songsData = new Map<string, Song>([[song.sourceUrl, song]])

    const payload = buildSharedLyricsPayload(session, songsData)
    expect(payload.v).toBe(1)
    expect(payload.name).toBe('Sunday Service')
    expect(payload.songs).toHaveLength(2)
    expect(payload.songs[0].entryId).toBe('occurrence-1')
    expect(payload.songs[1].entryId).toBe('occurrence-2')
    expect(payload.songs[0].sections[0].lines).toEqual(['Praise the Lord'])
    expect(payload.songs[1].sections[0].lines).toEqual(['Praise the Lord'])
  })

  it('validates song limits and loading status', () => {
    const song = createMockSong('s1', 'T1', 'A1', [])
    const songsData = new Map<string, Song>([[song.sourceUrl, song]])

    // Empty set
    expect(() => buildSharedLyricsPayload({ name: 'Empty', songs: [] }, songsData)).toThrow(ShareLyricsError)

    // Over 15 songs
    const tooMany = Array.from({ length: 16 }, (_, i) => ({
      entryId: `e-${i}`,
      url: song.sourceUrl,
      status: 'ok' as const,
    }))
    expect(() => buildSharedLyricsPayload({ name: 'Too Many', songs: tooMany }, songsData)).toThrow(ShareLyricsError)

    // Song not loaded
    const loadingSong: SessionSongItem[] = [
      { entryId: 'e-1', url: song.sourceUrl, status: 'loading' as const },
    ]
    expect(() => buildSharedLyricsPayload({ name: 'Loading', songs: loadingSong }, songsData)).toThrow(ShareLyricsError)

    // Missing local song data
    const missingSong: SessionSongItem[] = [
      { entryId: 'e-1', url: 'https://notfound.test', status: 'ok' as const },
    ]
    expect(() => buildSharedLyricsPayload({ name: 'Missing', songs: missingSong }, songsData)).toThrow(ShareLyricsError)
  })

  describe('cleanLyricLine', () => {
    it('trims leading and trailing whitespace', () => {
      expect(cleanLyricLine(' Better than I ever considered')).toBe('Better than I ever considered')
      expect(cleanLyricLine('   I want You most, Lord   ')).toBe('I want You most, Lord')
      expect(cleanLyricLine('\t\tLine with tabs\t')).toBe('Line with tabs')
    })

    it('collapses multiple consecutive internal spaces and tabs into a single space', () => {
      expect(cleanLyricLine('No exceptions,   undeniably free')).toBe('No exceptions, undeniably free')
      expect(cleanLyricLine('Word1    Word2\t\tWord3')).toBe('Word1 Word2 Word3')
    })

    it('returns empty string for empty or whitespace-only inputs', () => {
      expect(cleanLyricLine('')).toBe('')
      expect(cleanLyricLine('    ')).toBe('')
      expect(cleanLyricLine('\t  \t')).toBe('')
    })
  })

  describe('whitespace cleaning in extractSongLyrics', () => {
    it('removes chord-timing leading whitespace and collapses internal whitespace runs', () => {
      const sections: Section[] = [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: ' Better than I ever considered',
              chords: [{ chord: 'G', pos: 1 }],
            },
            {
              kind: 'lyric',
              text: 'Your forgiveness',
              chords: [{ chord: 'C', pos: 0 }],
            },
            {
              kind: 'lyric',
              text: 'Heals the depths of my being',
              chords: [{ chord: 'Em', pos: 0 }],
            },
            {
              kind: 'lyric',
              text: ' This is where I find acceptance',
              chords: [{ chord: 'D', pos: 1 }],
            },
            {
              kind: 'lyric',
              text: 'No exceptions,   undeniably free',
              chords: [
                { chord: 'C', pos: 0 },
                { chord: 'G', pos: 17 },
              ],
            },
          ],
        },
        {
          type: 'Chorus',
          label: 'Chorus',
          lines: [
            {
              kind: 'lyric',
              text: ' I want You most, Lord',
              chords: [{ chord: 'G', pos: 1 }],
            },
            {
              kind: 'lyric',
              text: ' I want You always',
              chords: [{ chord: 'C', pos: 1 }],
            },
            {
              kind: 'lyric',
              text: ' I want You more than ever',
              chords: [{ chord: 'D', pos: 1 }],
            },
            {
              kind: 'lyric',
              text: 'More than ever',
              chords: [{ chord: 'G', pos: 0 }],
            },
          ],
        },
      ]

      const song = createMockSong('song-timing', 'Timing Song', 'Artist', sections)
      const item: SessionSongItem = { entryId: 'e-1', url: song.sourceUrl, status: 'ok' }

      const structured = extractSongLyrics(item, song)

      expect(structured.sections[0].lines).toEqual([
        'Better than I ever considered',
        'Your forgiveness',
        'Heals the depths of my being',
        'This is where I find acceptance',
        'No exceptions, undeniably free',
      ])

      expect(structured.sections[1].lines).toEqual([
        'I want You most, Lord',
        'I want You always',
        'I want You more than ever',
        'More than ever',
      ])
    })

    it('collapses multiple consecutive blank lines inside a section to a single blank line', () => {
      const sections: Section[] = [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            { kind: 'lyric', text: 'Stanza 1 line 1', chords: [] },
            { kind: 'lyric', text: '   ', chords: [] },
            { kind: 'lyric', text: '', chords: [] },
            { kind: 'lyric', text: '   ', chords: [] },
            { kind: 'lyric', text: 'Stanza 2 line 1', chords: [] },
          ],
        },
      ]

      const song = createMockSong('song-blanks', 'Blanks Song', 'Artist', sections)
      const item: SessionSongItem = { entryId: 'e-1', url: song.sourceUrl, status: 'ok' }

      const structured = extractSongLyrics(item, song)
      expect(structured.sections[0].lines).toEqual([
        'Stanza 1 line 1',
        '',
        'Stanza 2 line 1',
      ])
    })

    it('does NOT mutate the original Song or Section objects', () => {
      const originalText = '   Preserve this raw text for chord alignment   '
      const sections: Section[] = [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: originalText,
              chords: [{ chord: 'G', pos: 3 }],
            },
          ],
        },
      ]

      const song = createMockSong('song-immutable', 'Immutability Test', 'Artist', sections)
      const item: SessionSongItem = { entryId: 'e-1', url: song.sourceUrl, status: 'ok' }

      const structured = extractSongLyrics(item, song)
      expect(structured.sections[0].lines).toEqual(['Preserve this raw text for chord alignment'])

      // The original song section line text MUST be completely untouched
      const originalLine = song.sections[0].lines[0]
      if (originalLine.kind === 'lyric') {
        expect(originalLine.text).toBe(originalText)
      }
    })
  })
})

