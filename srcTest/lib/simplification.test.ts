import { describe, expect, it } from 'vitest'
import { mergeOfficialSimplification } from '../../src/lib/simplification'
import type { Song } from '../../src/types/song'

function song(): Song {
  return {
    id: 'song-1',
    title: 'Song',
    artist: 'Artist',
    sourceUrl: 'https://tabs.ultimate-guitar.com/tab/song',
    sourceSite: 'ultimate-guitar',
    originalKey: 'G',
    capo: 2,
    sections: [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          {
            kind: 'lyric',
            text: 'Edited line',
            chords: [{ chord: 'Gmaj7', pos: 0 }],
          },
        ],
      },
    ],
    simplifiedSections: [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Generated line', chords: [{ chord: 'G', pos: 0 }] }],
      },
    ],
    simplifiedSource: 'algorithmic',
    simplificationPending: true,
  }
}

const official = {
  status: 'ok' as const,
  simplifiedSource: 'official' as const,
  simplifiedSections: [
    {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [{ kind: 'lyric' as const, text: 'Official line', chords: [{ chord: 'G', pos: 0 }] }],
    },
  ],
}

describe('mergeOfficialSimplification', () => {
  it('merges only simplification fields and preserves original edits/state', () => {
    const original = song()
    const merged = mergeOfficialSimplification(original, official)

    expect(merged.sections).toBe(original.sections)
    expect(merged.capo).toBe(2)
    expect(merged.originalKey).toBe('G')
    expect(merged.simplifiedSource).toBe('official')
    expect(merged.simplificationPending).toBe(false)
    expect(merged.simplifiedSections?.[0].lines[0]).toMatchObject({
      kind: 'lyric',
      text: 'Official line',
    })
  })

  it('never replaces a source-provided official chart', () => {
    const existing = { ...song(), simplifiedSource: 'official' as const }
    expect(mergeOfficialSimplification(existing, official)).toBe(existing)
  })

  it('leaves the song unchanged when enrichment is unavailable', () => {
    const existing = song()
    expect(
      mergeOfficialSimplification(existing, {
        status: 'unavailable',
        message: 'timed out',
      })
    ).toBe(existing)
  })
})
