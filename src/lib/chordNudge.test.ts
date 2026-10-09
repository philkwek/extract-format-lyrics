import { describe, it, expect } from 'vitest'
import { nudgeChord, setChordPos } from './chordNudge'
import type { Section } from '../types/song'

const sections = (): Section[] => [
  {
    type: 'Verse',
    label: 'Verse',
    lines: [{ kind: 'lyric', text: 'Hello world', chords: [{ pos: 0, chord: 'A' }, { pos: 6, chord: 'D' }] }],
  },
]

describe('chordNudge', () => {
  it('moves right and left by one char', () => {
    const right = nudgeChord(sections(), 0, 0, 1, 1)
    expect((right[0].lines[0] as { chords: { pos: number }[] }).chords[1].pos).toBe(7)
    const left = nudgeChord(right, 0, 0, 1, -1)
    expect((left[0].lines[0] as { chords: { pos: number }[] }).chords[1].pos).toBe(6)
  })

  it('clamps to line bounds', () => {
    const s = nudgeChord(sections(), 0, 0, 0, -5)
    expect((s[0].lines[0] as { chords: { pos: number }[] }).chords[0].pos).toBe(0)
    const e = setChordPos(sections(), 0, 0, 1, 999)
    expect((e[0].lines[0] as { chords: { pos: number }[] }).chords[1].pos).toBe(11)
  })

  it('does not mutate the input', () => {
    const s = sections()
    nudgeChord(s, 0, 0, 1, 1)
    expect((s[0].lines[0] as { chords: { pos: number }[] }).chords[1].pos).toBe(6)
  })
})
