import { describe, it, expect } from 'vitest'
import { detectSongKey, detect_song_key, detectSongKeyFromSections } from './keyDetector.js'
import { normalizeSongText } from './normalizer.js'

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

  it('uses whole-step IV-V major pair heuristic to identify parent key', () => {
    // E Major has A (IV) and B (V) separated by 2 semitones
    const sheet = `
[Chorus]
C#m    A    E    B
Hallelujah, my soul sings
`
    const res = detect_song_key(sheet)
    expect(res).not.toBeNull()
    expect(res?.key).toBe('E')
    expect(res?.formattedKey).toBe('E Major')
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
