import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Section } from './types.js'
import { detectSongKey, detect_song_key, detectSongKeyFromSections } from './keyDetector.js'
import { normalizeSongText } from './normalizer.js'
import { noteToIndex } from './chords.js'

describe('detectSongKey', () => {
  it('returns null for empty or chordless text', () => {
    expect(detectSongKey('')).toBeNull()
    expect(detectSongKey('   ')).toBeNull()
    expect(detectSongKey('Just a line of lyrics without chords')).toBeNull()
  })

  it('detects simple diatonic major key from I-IV-V progression', () => {
    const sheet = `
[Verse 1]
G        C
Amazing grace how sweet
D         G
That saved a wretch
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('G')
    expect(res?.formattedKey).toBe('G Major')
    expect(res?.relativeMinor).toBe('Em')
    expect(res?.formattedRelativeMinor).toBe('E minor')
    expect(res?.diatonicFitRatio).toBe(1.0)
    expect(res?.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps a bare minor-starting Axis loop ambiguous', () => {
    // A/B identifies the collection, but cannot establish E versus C# minor.
    const sheet = `
[Chorus]
C#m    A    E    B
Hallelujah, my soul sings
`
    const res = detect_song_key(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('C#m')
    expect(res?.formattedKey).toBe('C# minor')
    expect(res?.confidence).toBeLessThanOrEqual(0.6)
    expect(res?.relative_minor).toBe('C# minor')
    expect(res?.chords_detected).toEqual(expect.arrayContaining(['C#m', 'A', 'E', 'B']))
  })

  it('correctly detects key when progression starts on IV (e.g. F - G - C)', () => {
    // Starts on F (IV), then G (V), then resolves to C (I)
    const sheet = `
[Verse]
F         G
Here I am down on my knees
C         Am
Loving you Lord
F         G
Here I am down on my knees
C
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('C')
    expect(res?.formattedKey).toBe('C Major')
  })

  it('disambiguates relative minor when song is centered on minor tonic (Am)', () => {
    const sheet = `
[Verse 1]
Am       Dm
Darkness falls upon the land
Em       Am
Cold wind blows across the sand
Am       Dm
Hear the cry in the night
Am
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('Am')
    expect(res?.formattedKey).toBe('A minor')
    expect(res?.relativeMinor).toBe('Am')
  })

  it('recognizes harmonic minor with major V chord (e.g. E in Am)', () => {
    const sheet = `
[Verse 1]
Am       Dm
Lost in thought again
E        Am
Waiting for the end
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('Am')
    expect(res?.formattedKey).toBe('A minor')
  })

  it('weights Chorus sections more heavily to determine tonal center', () => {
    // Verse meanders starting on Dm and G, but Chorus decisively anchors on C
    const sheet = `
[Verse 1]
Dm       G
Walking in the shadow
Dm       G
Looking for a sign

[Chorus]
C        F
This is my life
G        C
This is my home
C        F
All for the King
G        C
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('C')
    expect(res?.formattedKey).toBe('C Major')
  })

  it('handles flat key signatures correctly (e.g. Eb Major)', () => {
    const sheet = `
[Verse]
Eb       Ab
Bb       Eb
Fm       Bb
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('Eb')
    expect(res?.formattedKey).toBe('Eb Major')
    expect(res?.relativeMinor).toBe('Cm')
  })

  it('works directly with structured Section[] via detectSongKeyFromSections', () => {
    const sections = normalizeSongText(`
[Verse 1]
D      G
A      D
`)
    const res = detectSongKeyFromSections(sections)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('D')
    expect(res?.relativeMinor).toBe('Bm')
  })

  it('detects key from inline bracketed chords within lyric lines', () => {
    const sheet = `
[Verse 1]
[G]Amazing [C]grace how sweet the sound
That [D]saved a wretch like [G]me
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('G')
  })

  it('correctly detects G major for songs starting on C (IV) with C D Am G chords', () => {
    const sheet = `
[Verse]
C
Standing in awe of your grace
D
Setting my feet in your ways
Am                  G
Entering into your presence
D                   G
To behold you face to face

[Chorus]
C
My Jesus, my lord
Am
Wherever you go
D
No longer I
G
Serving you for all eternity
C
I'll follow you
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('G')
    expect(res?.formattedKey).toBe('G Major')
    expect(res?.diatonicFitRatio).toBe(1.0)
  })

  it('correctly detects E major for songs with C#m A E B progression when Chorus anchors on E', () => {
    const sheet = `
[Verse 1]
C#m    A    E    B
When life is heavy and my strength is faint
C#m    A
There's beauty for ashes
E    B
There's joy in my pain

[Chorus]
E           C#m
We are wrapped in resurrection
B           A
You have clothed us in Your glory
E           C#m
Now our hearts are no longer wandering
B
You've become our sanctuary
`
    const res = detectSongKey(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('E')
    expect(res?.formattedKey).toBe('E Major')
    expect(res?.relative_minor).toBe('C# minor')
    expect(res?.diatonicFitRatio).toBe(1.0)
  })
})

// These expectations specify the chart heuristic, not certainty about an unheard melody.
describe('tonal-center regressions', () => {
  const cases = [
    ['Aeolian with explicit minor ending', '[Chorus]\nAm F C G Am F C G Am', 'Am'],
    ['major Axis with major ending', '[Chorus]\nC G Am F C', 'C'],
    ['Mixolydian tonic anchor', '[Chorus]\nE D A E', 'E'],
    ['Dorian minor anchor', '[Chorus]\nAm D Am G Am', 'Am'],
    ['harmonic minor ii half-diminished V7 i', '[Verse]\nAm Bm7b5 E7 Am', 'Am'],
    ['leading-tone diminished in major', '[Verse]\nC F Bdim C G7 C', 'C'],
    ['secondary dominant does not force relative minor', '[Chorus]\nC F G C Am E7 Am G7 C', 'C'],
    ['minor chorus after a major verse', '[Verse]\nC F G C\n[Chorus]\nAm Dm E7 Am', 'Am'],
    ['major chorus after a minor verse', '[Verse]\nAm Dm E7 Am\n[Chorus]\nC F G7 C', 'C'],
    ['flat tonic with matching relative spelling', '[Verse]\nGb Cb Db Gb', 'Gb'],
    ['sharp tonic with matching relative spelling', '[Verse]\nF# B C# F#', 'F#'],
    ['C sharp minor despite altered fifth flat hint', '[Verse]\nC#m D#m7b5 G#7 C#m', 'C#m'],
    ['D flat major uses conventional spelling', '[Verse]\nDb Gb Ab7 Db', 'Db'],
    ['suspended dominant resolution', '[Verse]\nG C Dsus4 D7 G', 'G'],
  ]
  it.each(cases)('%s', (_name, text, key) => {
    expect(detectSongKey(text)?.key).toBe(key)
  })

  it('reports strict fit separately from harmonic-minor compatibility', () => {
    const result = detectSongKey('[Verse]\nAm Bm7b5 E7 Am')!
    expect(result.diatonicFitRatio).toBe(0.67)
    expect(result.diatonic_fit_ratio).toBe(result.diatonicFitRatio)
  })

  it('does not treat B minor as the diminished degree in C major', () => {
    expect(detectSongKey('[Verse]\nC F G Bm C')?.diatonicFitRatio).toBe(0.75)
  })

  it('keeps sparse and thirdless charts low confidence', () => {
    expect(detectSongKey('[Verse]\nC')?.confidence).toBeLessThanOrEqual(0.55)
    expect(detectSongKey('[Verse]\nA5 D5 E5 A5')?.confidence).toBeLessThanOrEqual(0.35)
  })

  it('does not turn annotation duplication into confidence 1.0', () => {
    for (const repeats of [1, 2, 8, 32]) {
      const text = '[Chorus]\n' + Array(repeats).fill('Am F C G').join(' ')
      expect(detectSongKey(text)?.key).toBe('Am')
      expect(detectSongKey(text)?.confidence).toBeLessThanOrEqual(0.6)
    }
  })

  it('matches lyric placements and chords-only input without mutating sections', () => {
    const sections = normalizeSongText('[Verse]\nAm Bm7b5 E7 Am')
    const before = JSON.stringify(sections)
    const lyric = [{ type: 'Verse', label: 'Verse', lines: [{ kind: 'lyric' as const,
      text: 'sing', chords: ['Am', 'Bm7b5', 'E7', 'Am'].map((chord, pos) => ({ chord, pos })) }] }]
    expect(detectSongKeyFromSections(lyric)).toEqual(detectSongKeyFromSections(sections))
    expect(JSON.stringify(sections)).toBe(before)
  })

  it('does not invent a cadence across section boundaries', () => {
    const result = detectSongKey('[Verse]\nF G\n[Chorus]\nC Am')!
    expect(result.confidence).toBeLessThanOrEqual(0.6)
  })

  it('ignores altered fifth and slash bass for accidental preference', () => {
    expect(detectSongKey('[Verse]\nF# B C#7(b9)/Gb F#')?.key).toBe('F#')
  })
})

describe('transposition invariance', () => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  it.each(Array.from({ length: 12 }, (_, shift) => [shift]))('preserves anchored tonic under shift %i', shift => {
    for (const [offsets, minor] of [
      [[0, 5, 7, 0], false], // I IV V I
      [[0, 10, 5, 0], false], // Mixolydian I bVII IV I
      [[0, 5, 0, 10, 0], true], // Dorian i IV i bVII i
    ] as const) {
      const chords = offsets.map(offset => names[(offset + shift) % 12] + (minor && offset === 0 ? 'm' : ''))
      const result = detectSongKeyFromSections([{ type: 'Chorus', label: 'Chorus', lines: [{ kind: 'chords-only', chords }] }])!
      expect(noteToIndex(result.key.replace(/m$/, ''))).toBe(shift)
      expect(result.key.endsWith('m')).toBe(minor)
    }
  })
})


describe('Heart of a Servant UG chart 1905600', () => {
  // Chord order/section boundaries transcribed from the linked chart on 2026-10-14.
  // Includes the final C and repeated annotations omitted by the earlier example.
  const verse = 'C D Am G D G C D Am G D G'.split(' ')
  const chorus = 'C C Am D D G C C Am Am D D G G C'.split(' ')
  const chart = (repeat: number) => [
    { type: 'Verse', label: 'Verse', lines: [{ kind: 'chords-only' as const, chords: verse.flatMap(chord => Array<string>(repeat).fill(chord)) }] },
    { type: 'Chorus', label: 'Chorus', lines: [{ kind: 'chords-only' as const, chords: chorus.flatMap(chord => Array<string>(repeat).fill(chord)) }] },
  ]
  it.each([1, 2, 8])('detects G regardless of repeated chord annotations (%i)', repeat => {
    const result = detectSongKeyFromSections(chart(repeat))!
    expect(result.key).toBe('G')
    expect(result.diatonicFitRatio).toBe(1)
    expect(result.chordsDetected).toEqual(['C', 'D', 'Am', 'G'])
    expect(result).toEqual(detectSongKeyFromSections(chart(1)))
  })
  it('keeps the result through text normalization', () => {
    expect(detectSongKey('[Verse]\n' + verse.join(' ') + '\n[Chorus]\n' + chorus.join(' '))?.key).toBe('G')
  })
})


it('transposes the full IV-starting/IV-ending chart consistently', () => {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  for (let shift = 0; shift < 12; shift++) {
    const transpose = (text: string) => text.split(' ').map(chord => {
      const minor = chord.endsWith('m')
      const root = noteToIndex(chord.replace(/m$/, ''))!
      return notes[(root + shift) % 12] + (minor ? 'm' : '')
    })
    const result = detectSongKeyFromSections([
      { type: 'Verse', label: '', lines: [{ kind: 'chords-only', chords: transpose('C D Am G D G C D Am G D G') }] },
      { type: 'Chorus', label: '', lines: [{ kind: 'chords-only', chords: transpose('C C Am D D G C C Am Am D D G G C') }] },
    ])!
    expect(noteToIndex(result.key)).toBe((7 + shift) % 12)
  }
})


describe('Fresh Fire UG chart 5088748', () => {
  // Chords and section order observed on the linked chart on 2026-10-14.
  const chart: Array<{ type: Section['type']; label: string; chords: string[] }> = JSON.parse(
    readFileSync(new URL('./__fixtures__/fresh-fire-5088748.json', import.meta.url), 'utf8'),
  )
  const sections: Section[] = chart.map(({ type, label, chords }) => ({
    type, label, lines: [{ kind: 'chords-only', chords }],
  }))
  it('detects C despite the Am-starting intro and verses', () => {
    const result = detectSongKeyFromSections(sections)!
    expect(result.key).toBe('C')
    expect(result.diatonicFitRatio).toBe(1)
    expect(result.confidence).toBeLessThanOrEqual(0.6)
  })
  it('keeps C through normalization and chord-line deduplication', () => {
    const text = chart.map(({ label, chords }) => `[${label}]\n${chords.join(' ')}`).join('\n')
    expect(detectSongKey(text)?.key).toBe('C')
  })
  it('preserves the major center through all twelve transpositions', () => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    for (let shift = 0; shift < 12; shift++) {
      const shifted: Section[] = chart.map(({ type, label, chords }) => ({
        type, label, lines: [{ kind: 'chords-only', chords: chords.map(chord =>
          notes[(noteToIndex(chord.replace(/m$/, ''))! + shift) % 12] + (chord.endsWith('m') ? 'm' : ''),
        ) }],
      }))
      expect(noteToIndex(detectSongKeyFromSections(shifted)!.key)).toBe(shift)
    }
  })
})
