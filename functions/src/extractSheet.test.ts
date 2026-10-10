import { describe, it, expect } from 'vitest'
import {
  bracketedLineToModelLine,
  extractChordsFromSpacedLine,
  positionedLineToModelLine,
  rawLineToModelLine,
  transformRawSongsToAppSongs,
  isExpectedSongCount,
  needsSongCountRetry,
  mergeConsecutiveSongs,
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

describe('mergeConsecutiveSongs', () => {
  it('merges only adjacent continuation pages with the same title', () => {
    const songs = mergeConsecutiveSongs([
      { title: 'Song A', sections: [{ type: 'Verse', label: 'Verse 1', lines: [] }] },
      { title: 'Song A', sections: [{ type: 'Chorus', label: 'Chorus', lines: [] }] },
      { title: 'Song B', sections: [{ type: 'Verse', label: 'Verse 1', lines: [] }] },
    ])
    expect(songs).toHaveLength(2)
    expect(songs[0].sections.map((section) => section.label)).toEqual(['Verse 1', 'Chorus'])
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

describe('positionedLineToModelLine spacing', () => {
  it('preserves each line’s individual leading indent and geometric word gaps', () => {
    const line = positionedLineToModelLine(
      [
        { text: 'You', x0: 30, x1: 60 },
        { text: 'bring', x0: 100, x1: 150 },
      ],
      [{ chord: 'G', x0: 0, x1: 10 }, { chord: 'D', x0: 100, x1: 110 }]
    )

    expect(line).toEqual({
      kind: 'lyric',
      text: '   You    bring',
      chords: [{ chord: 'G', pos: 0 }, { chord: 'D', pos: 10 }],
    })
  })

  it('keeps repeat chords after the final lyric at their extracted horizontal positions', () => {
    const line = positionedLineToModelLine(
      [{ text: 'God', x0: 50, x1: 80 }],
      [{ chord: 'G2', x0: 50, x1: 65 }, { chord: 'A/G', x0: 150, x1: 175 }]
    )
    expect(line).toEqual({
      kind: 'lyric',
      text: 'God          ',
      chords: [{ chord: 'G2', pos: 0 }, { chord: 'A/G', pos: 10 }],
    })
  })
})

describe('rawLineToModelLine chord-row recovery', () => {
  it('converts a vision-labelled lyric row containing only positioned chords into an editable chords-only line', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      words: [
        { text: 'G', x0: 0, x1: 10 },
        { text: 'D/F#', x0: 80, x1: 105 },
        { text: 'Em7', x0: 160, x1: 185 },
      ],
    })
    expect(line).toEqual({ kind: 'chords-only', chords: ['G', 'D/F#', 'Em7'] })
  })

  it('keeps a real lyric row containing a chord-like word as lyrics', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      words: [
        { text: 'A', x0: 0, x1: 10 },
        { text: 'mighty', x0: 20, x1: 60 },
        { text: 'fortress', x0: 70, x1: 120 },
      ],
    })
    expect(line).toMatchObject({ kind: 'lyric', chords: [] })
    if (line.kind === 'lyric') expect(line.text.replace(/\s+/g, ' ').trim()).toBe('A mighty fortress')
  })

  it('rejoins superscript-style chord fragments and ignores a Last x annotation', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      words: [
        { text: 'G', x0: 0, x1: 10 },
        { text: '2', x0: 10, x1: 16 },
        { text: 'A', x0: 50, x1: 60 },
        { text: 'sus', x0: 60, x1: 78 },
        { text: '(D', x0: 100, x1: 112 },
        { text: '2)', x0: 112, x1: 120 },
        { text: '(Last', x0: 140, x1: 170 },
        { text: 'x)', x0: 172, x1: 182 },
      ],
    })
    expect(line).toEqual({ kind: 'chords-only', chords: ['G2', 'Asus', 'D2'] })
  })

  it('keeps numbered repeat and interlude cues out of a chord-only row’s lyric text', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      words: [
        { text: '(1.)', x0: 0, x1: 24 },
        { text: 'D/F#', x0: 35, x1: 62 },
        { text: 'G', x0: 110, x1: 120 },
        { text: '2', x0: 120, x1: 128 },
        { text: 'A/G', x0: 165, x1: 190 },
        { text: 'G', x0: 220, x1: 230 },
        { text: '2', x0: 230, x1: 238 },
        { text: 'A/G', x0: 270, x1: 295 },
        { text: 'G', x0: 325, x1: 335 },
        { text: '2', x0: 335, x1: 343 },
        { text: '(To', x0: 380, x1: 400 },
        { text: 'Interlude', x0: 402, x1: 450 },
        { text: '1a)', x0: 452, x1: 468 },
      ],
    })
    expect(line).toEqual({ kind: 'chords-only', chords: ['D/F#', 'G2', 'A/G', 'G2', 'A/G', 'G2'] })
  })

  it('keeps parenthesized chord qualities attached to their superscript number', () => {
    const line = rawLineToModelLine({
      kind: 'lyric',
      words: [
        { text: 'D', x0: 0, x1: 10 },
        { text: 'Em', x0: 70, x1: 88 },
        { text: '7', x0: 88, x1: 95 },
        { text: 'G', x0: 140, x1: 150 },
        { text: '2(no3)', x0: 150, x1: 185 },
      ],
    })
    expect(line).toEqual({ kind: 'chords-only', chords: ['D', 'Em7', 'G2(no3)'] })
  })
})

describe('scanned chord-to-lyric pairing', () => {
  it('attaches a recovered positioned chord row to the lyric row directly beneath it', () => {
    const songs = transformRawSongsToAppSongs([{
      title: 'Paired scan',
      sections: [{
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          {
            // This is how a scan can incorrectly label the chord row.
            kind: 'lyric',
            words: [{ text: 'G', x0: 0, x1: 10 }, { text: 'D', x0: 120, x1: 130 }],
          },
          {
            kind: 'lyric',
            words: [{ text: 'Amazing', x0: 40, x1: 95 }, { text: 'grace', x0: 120, x1: 160 }],
          },
        ],
      }],
    }])

    expect(songs[0].sections[0].lines).toHaveLength(1)
    const line = songs[0].sections[0].lines[0]
    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') {
      expect(line.text.replace(/\s+/g, ' ').trim()).toBe('Amazing grace')
      expect(line.chords.map((chord) => chord.chord)).toEqual(['G', 'D'])
    }
  })

  it('attaches a superscript-fragment chord row instead of leaving it as lyric text', () => {
    const songs = transformRawSongsToAppSongs([{
      title: 'Superscript scan',
      sections: [{
        type: 'Chorus',
        label: 'Chorus',
        lines: [
          { kind: 'lyric', words: [{ text: 'G', x0: 0, x1: 10 }, { text: '2', x0: 10, x1: 16 }, { text: 'A', x0: 100, x1: 110 }, { text: 'sus', x0: 110, x1: 128 }] },
          { kind: 'lyric', words: [{ text: 'I', x0: 40, x1: 50 }, { text: 'sing', x0: 100, x1: 130 }] },
        ],
      }],
    }])
    const line = songs[0].sections[0].lines[0]
    expect(line.kind).toBe('lyric')
    if (line.kind === 'lyric') expect(line.chords.map((chord) => chord.chord)).toEqual(['G2', 'Asus'])
  })
})

describe('scanned footer and section-header recovery', () => {
  it('removes copyright and publishing credits returned as lyric rows', () => {
    const songs = transformRawSongsToAppSongs([{
      title: 'Credits',
      sections: [{
        type: 'Outro',
        label: 'Ending',
        lines: [
          { kind: 'lyric', content: 'Great are You Lord' },
          { kind: 'lyric', content: "© 2012 Open Hands Music | Integrity's Praise! Music | Little Way Creative" },
        ],
      }],
    }])
    expect(songs[0].sections[0].lines).toEqual([{ kind: 'lyric', text: 'Great are You Lord', chords: [] }])
  })

  it('promotes in-body Instrumental labels into separate editable sections', () => {
    const songs = transformRawSongsToAppSongs([{
      title: 'Instrumentals',
      sections: [{
        type: 'Chorus',
        label: 'Chorus',
        lines: [
          { kind: 'lyric', content: "It's Your breath in our lungs" },
          { kind: 'lyric', content: 'INSTRUMENTAL 1' },
          { kind: 'lyric', words: [{ text: 'G', x0: 0, x1: 10 }, { text: 'Bm', x0: 80, x1: 100 }] },
          { kind: 'lyric', content: 'Instrumental 2' },
          { kind: 'lyric', words: [{ text: 'D', x0: 0, x1: 10 }, { text: 'G', x0: 80, x1: 90 }] },
        ],
      }],
    }])

    expect(songs[0].sections.map((section) => [section.type, section.label])).toEqual([
      ['Chorus', 'Chorus'],
      ['Instrumental', 'INSTRUMENTAL 1'],
      ['Instrumental', 'Instrumental 2'],
    ])
    expect(songs[0].sections[1].lines).toEqual([{ kind: 'chords-only', chords: ['G', 'Bm'] }])
    expect(songs[0].sections[2].lines).toEqual([{ kind: 'chords-only', chords: ['D', 'G'] }])
  })

  it('promotes lettered interlude cues into Instrumental sections', () => {
    const songs = transformRawSongsToAppSongs([{
      title: 'Lettered cue',
      sections: [{
        type: 'Verse',
        label: 'Verse',
        lines: [
          { kind: 'lyric', content: 'None can fathom' },
          { kind: 'lyric', content: 'INTERLUDE 1A' },
          { kind: 'lyric', content: '(You are amazing God)' },
          { kind: 'lyric', words: [{ text: 'Em', x0: 0, x1: 15 }, { text: 'D', x0: 60, x1: 70 }] },
        ],
      }],
    }])

    expect(songs[0].sections.map((section) => [section.type, section.label])).toEqual([
      ['Verse', 'Verse'],
      ['Instrumental', 'INTERLUDE 1A'],
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
