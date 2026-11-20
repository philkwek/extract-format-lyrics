import { describe, expect, it } from 'vitest'
import { fitCaption, songCount } from '../../src/lib/plural'

describe('songCount', () => {
  it('uses the singular for one song', () => {
    expect(songCount(1)).toBe('1 song')
  })

  it('uses the plural for zero and many songs', () => {
    expect(songCount(0)).toBe('0 songs')
    expect(songCount(3)).toBe('3 songs')
  })
})

describe('fitCaption', () => {
  it('reads as plain musician copy with a plural count', () => {
    expect(fitCaption(3, 14)).toBe('Fits the screen · 3 columns · text size 14')
  })

  it('keeps a single column singular', () => {
    expect(fitCaption(1, 16)).toBe('Fits the screen · 1 column · text size 16')
  })
})
