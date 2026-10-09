import { describe, expect, it } from 'vitest'
import { formatOffset, keyOffset, keyOptions, matchKeyOption } from './keys'

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
  it('has 12 keys per mode', () => {
    expect(keyOptions(false)).toHaveLength(12)
    expect(keyOptions(true)).toHaveLength(12)
    expect(keyOptions(true).every((k) => k.endsWith('m'))).toBe(true)
  })

  it('matches enharmonic spellings', () => {
    expect(matchKeyOption('A#')).toBe('Bb')
    expect(matchKeyOption('Dbm')).toBe('C#m')
    expect(matchKeyOption('G')).toBe('G')
  })
})
