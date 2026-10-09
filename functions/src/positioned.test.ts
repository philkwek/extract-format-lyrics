import { describe, it, expect } from 'vitest'
import { positionedLineToModelLine } from './extractSheet.js'

const w = (text: string, x0: number, x1: number) => ({ text, x0, x1 })

describe('positionedLineToModelLine', () => {
  it('puts A2 over "Presence" and E/G# over "-" in the chorus line', () => {
    const words = [
      w('Here', 55, 90), w('in', 95, 110), w('Your', 115, 150), w('Presence', 155, 235),
      w('we', 240, 262), w('are', 267, 295), w('un', 300, 322), w('-', 327, 335), w('done', 450, 495),
    ]
    const line = positionedLineToModelLine(words, [
      { chord: 'A2', x0: 185, x1: 205 },
      { chord: 'E/G#', x0: 395, x1: 430 },
    ])
    if (line.kind !== 'lyric') throw new Error('expected lyric')
    const at = (c: string) => line.text.slice(line.chords.find((x) => x.chord === c)!.pos).split(' ')[0]
    expect(at('A2')).toBe('Presence')
    expect(at('E/G#')).toBe('done')
  })

  it('keeps a pre-vocal chord as a timing rest with indent', () => {
    const words = [w('Heaven', 130, 190), w('is', 195, 210), w('trembling', 215, 300)]
    const line = positionedLineToModelLine(words, [
      { chord: 'F#m7', x0: 55, x1: 90 },
      { chord: 'E', x0: 225, x1: 235 },
    ])
    if (line.kind !== 'lyric') throw new Error('expected lyric')
    expect(line.chords[0]).toEqual({ pos: 0, chord: 'F#m7' })
    expect(line.text.startsWith(' '.repeat(5))).toBe(true)
    expect(line.text.trimStart().startsWith('Heaven')).toBe(true)
    const e = line.chords.find((c) => c.chord === 'E')!
    expect(line.text.slice(e.pos).startsWith('trembling')).toBe(true)
  })
})
