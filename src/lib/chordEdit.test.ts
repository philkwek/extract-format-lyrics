import { describe, it, expect } from 'vitest'
import {
  parseChordComponents,
  applyRoot,
  applyAccidental,
  applyQuality,
  applySlash,
} from './chordEdit'

describe('chordEdit', () => {
  it('parses chord components correctly', () => {
    expect(parseChordComponents('G')).toEqual({
      root: 'G',
      accidental: '',
      quality: '',
      bass: '',
      raw: 'G',
    })

    expect(parseChordComponents('C#m7/G#')).toEqual({
      root: 'C',
      accidental: '#',
      quality: 'm7',
      bass: 'G#',
      raw: 'C#m7/G#',
    })

    expect(parseChordComponents('Bb/D')).toEqual({
      root: 'B',
      accidental: 'b',
      quality: '',
      bass: 'D',
      raw: 'Bb/D',
    })
  })

  it('applies and replaces root notes correctly', () => {
    expect(applyRoot('', 'C')).toBe('C')
    expect(applyRoot('G', 'D')).toBe('D')
    expect(applyRoot('Gsus4', 'A')).toBe('Asus4')
    expect(applyRoot('C#m7', 'D')).toBe('D#m7')
    expect(applyRoot('G/B', 'C')).toBe('C/B')
    expect(applyRoot('G/', 'B')).toBe('G/B')
  })

  it('toggles accidentals on root and bass', () => {
    // Add sharp to C
    expect(applyAccidental('C', '#')).toBe('C#')
    // Toggle sharp off C#
    expect(applyAccidental('C#', '#')).toBe('C')
    // Swap sharp to flat
    expect(applyAccidental('C#', 'b')).toBe('Cb')

    // Preserve quality when adding accidental
    expect(applyAccidental('Cm7', '#')).toBe('C#m7')

    // Apply accidental to bass note if present
    expect(applyAccidental('G/B', 'b')).toBe('G/Bb')
    expect(applyAccidental('G/Bb', 'b')).toBe('G/B')
  })

  it('applies qualities and clears with maj', () => {
    expect(applyQuality('G', 'm')).toBe('Gm')
    expect(applyQuality('G', '7')).toBe('G7')
    expect(applyQuality('Gsus4', 'm7')).toBe('Gm7')
    expect(applyQuality('Gm/B', 'sus4')).toBe('Gsus4/B')
    expect(applyQuality('Gm7', 'maj')).toBe('G')
  })

  it('handles slash toggling', () => {
    expect(applySlash('G')).toBe('G/')
    expect(applySlash('G/')).toBe('G')
    expect(applySlash('G/B')).toBe('G/')
  })
})
