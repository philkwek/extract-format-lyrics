import { describe, expect, it } from 'vitest'
import { getSheetSections } from '../../src/lib/sheetSections'
import type { Song } from '../../src/types/song'

const song: Song = {
  id: 'song-1',
  title: 'Demo Song',
  artist: 'Demo Artist',
  sourceUrl: 'https://example.test/demo',
  sourceSite: 'Demo',
  originalKey: 'G',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [
        {
          kind: 'lyric',
          text: 'You give life, You are love',
          chords: [
            { chord: 'G', pos: 0 },
            { chord: 'C', pos: 13 },
          ],
        },
      ],
    },
  ],
  simplifiedSections: [
    {
      type: 'Chorus',
      label: 'Chorus',
      lines: [
        {
          kind: 'lyric',
          text: 'Simple line',
          chords: [{ chord: 'Em', pos: 0 }],
        },
      ],
    },
  ],
}

describe('getSheetSections', () => {
  it('shows the plain sections when the item is not simplified or transposed', () => {
    expect(getSheetSections(song, {})).toBe(song.sections)
  })

  it('shows the simplified sections when the set item asks for them', () => {
    expect(getSheetSections(song, { simplified: true })).toBe(song.simplifiedSections)
  })

  it('falls back to the plain sections when there is no simplified chart', () => {
    const plainOnly: Song = { ...song, simplifiedSections: undefined }
    expect(getSheetSections(plainOnly, { simplified: true })).toBe(plainOnly.sections)
  })

  it('transposes the plain sections to the item key', () => {
    const sections = getSheetSections(song, { targetKey: 'A' })
    const line = sections[0].lines[0]
    expect(line.kind).toBe('lyric')
    if (line.kind !== 'lyric') return
    expect(line.chords.map((chord) => chord.chord)).toEqual(['A', 'D'])
    expect(line.text).toBe('You give life, You are love')
  })

  it('transposes the simplified sections when both are chosen', () => {
    const sections = getSheetSections(song, {
      simplified: true,
      targetKey: 'A',
    })
    const line = sections[0].lines[0]
    expect(line.kind).toBe('lyric')
    if (line.kind !== 'lyric') return
    expect(line.chords.map((chord) => chord.chord)).toEqual(['F#m'])
  })
})

describe('getSheetSections identity', () => {
  it('returns the same array for the same song, chart and key', () => {
    const song = {
      id: 's',
      title: 'Demo',
      artist: 'Demo Band',
      sourceUrl: 'https://example.com/s',
      sourceSite: 'Demo',
      originalKey: 'G',
      sections: [
        {
          type: 'Verse' as const,
          label: 'Verse 1',
          lines: [
            { kind: 'lyric' as const, text: 'Morning light', chords: [{ pos: 0, chord: 'G' }] },
          ],
        },
      ],
    }
    const first = getSheetSections(song, { targetKey: 'A' })
    expect(getSheetSections(song, { targetKey: 'A' })).toBe(first)
    expect(getSheetSections(song, { targetKey: 'D' })).not.toBe(first)
  })
})
