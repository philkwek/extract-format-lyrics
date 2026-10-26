import { describe, expect, it } from 'vitest'
import { formatOffset, keyOffset, keyOptions, matchKeyOption } from '../../src/lib/keys'

describe('keyOffset', () => {
  it('computes the shortest signed offset', () => {
    expect(keyOffset('G', 'A')).toBe(2)
    expect(keyOffset('G', 'E')).toBe(-3)
    expect(keyOffset('G', 'G')).toBe(0)
    expect(keyOffset('C', 'F#')).toBe(6)
    expect(keyOffset('Am', 'Cm')).toBe(3)
  })

  it('returns 0 for unknown keys', () => {
    expect(keyOffset('?', 'G')).toBe(0)
  })
})

describe('formatOffset', () => {
  it('formats signs', () => {
    expect(formatOffset(2)).toBe('+2')
    expect(formatOffset(-3)).toBe('−3')
    expect(formatOffset(0)).toBe('0')
  })
})

describe('keyOptions', () => {
  it('has 17 keys per mode', () => {
    expect(keyOptions(false)).toHaveLength(17)
    expect(keyOptions(true)).toHaveLength(17)
    expect(keyOptions(true).every((k) => k.endsWith('m'))).toBe(true)
  })

  it('includes both sharp and flat spellings for every black-key pitch class', () => {
    const majorPairs = [
      ['C#', 'Db'],
      ['D#', 'Eb'],
      ['F#', 'Gb'],
      ['G#', 'Ab'],
      ['A#', 'Bb'],
    ]
    const minorPairs = [
      ['C#m', 'Dbm'],
      ['D#m', 'Ebm'],
      ['F#m', 'Gbm'],
      ['G#m', 'Abm'],
      ['A#m', 'Bbm'],
    ]

    for (const [sharp, flat] of majorPairs) {
      expect(keyOptions(false)).toContain(sharp)
      expect(keyOptions(false)).toContain(flat)
    }
    for (const [sharp, flat] of minorPairs) {
      expect(keyOptions(true)).toContain(sharp)
      expect(keyOptions(true)).toContain(flat)
    }
  })

  it('preserves exact spellings and resolves enharmonics', () => {
    expect(matchKeyOption('A#')).toBe('A#')
    expect(matchKeyOption('Bb')).toBe('Bb')
    expect(matchKeyOption('Dbm')).toBe('Dbm')
    expect(matchKeyOption('C#m')).toBe('C#m')
    expect(matchKeyOption('F♯')).toBe('F#')
    expect(matchKeyOption('Cb')).toBe('B')
    expect(matchKeyOption('G')).toBe('G')
  })
})
