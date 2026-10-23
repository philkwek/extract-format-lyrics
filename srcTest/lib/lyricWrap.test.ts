import { describe, expect, it } from 'vitest'
import { wrapLyricLine } from '../../src/lib/lyricWrap'

describe('wrapLyricLine', () => {
  it('keeps a short line on one row', () => {
    const rows = wrapLyricLine(
      { kind: 'lyric', text: 'Amazing grace', chords: [{ chord: 'G', pos: 0 }] },
      40,
    )

    expect(rows).toEqual([
      {
        text: 'Amazing grace',
        chords: [{ chord: 'G', pos: 0, originalIndex: 0 }],
        start: 0,
      },
    ])
  })

  it('wraps at word starts and keeps chords with their lyric slice', () => {
    const rows = wrapLyricLine(
      {
        kind: 'lyric',
        text: 'how sweet the sound',
        chords: [
          { chord: 'G', pos: 0 },
          { chord: 'C', pos: 4 },
          { chord: 'Em', pos: 10 },
        ],
      },
      12,
    )

    expect(rows.map((row) => row.text)).toEqual(['how sweet ', 'the sound'])
    expect(rows[0].chords).toEqual([
      { chord: 'G', pos: 0, originalIndex: 0 },
      { chord: 'C', pos: 4, originalIndex: 1 },
    ])
    expect(rows[1].start).toBe(10)
    expect(rows[1].chords).toEqual([{ chord: 'Em', pos: 0, originalIndex: 2 }])
  })

  it('moves a chord anchored at the break onto the next row', () => {
    const rows = wrapLyricLine(
      {
        kind: 'lyric',
        text: 'hello world',
        chords: [
          { chord: 'G', pos: 0 },
          { chord: 'D', pos: 6 },
        ],
      },
      8,
    )

    expect(rows.map((row) => row.text)).toEqual(['hello ', 'world'])
    expect(rows[0].chords).toEqual([{ chord: 'G', pos: 0, originalIndex: 0 }])
    expect(rows[1].chords).toEqual([{ chord: 'D', pos: 0, originalIndex: 1 }])
  })

  it('accounts for chord widths when deciding where to break', () => {
    const rows = wrapLyricLine(
      {
        kind: 'lyric',
        text: 'hello world',
        chords: [{ chord: 'Cmaj7', pos: 6 }],
      },
      8,
    )

    // The chord plus its one-cell gap is wider than "world", so it must start
    // the second row rather than stretching the first row past the column.
    expect(rows.map((row) => row.text)).toEqual(['hello ', 'world'])
    expect(rows[1].chords).toEqual([{ chord: 'Cmaj7', pos: 0, originalIndex: 0 }])
  })

  it('hard-breaks a single word that is wider than the column', () => {
    const rows = wrapLyricLine(
      { kind: 'lyric', text: 'Supercalifragilistic', chords: [] },
      8,
    )

    expect(rows.length).toBeGreaterThan(1)
    expect(rows.map((row) => row.text).join('')).toBe('Supercalifragilistic')
    expect(rows.every((row) => row.text.length <= 8)).toBe(true)
  })

  it('preserves the exact lyric string across all rows', () => {
    const text = '  a  long   line with   uneven spacing  '
    const rows = wrapLyricLine({ kind: 'lyric', text, chords: [] }, 7)

    expect(rows.map((row) => row.text).join('')).toBe(text)
  })

  it('keeps a line with no text unchanged when it only has chords', () => {
    const rows = wrapLyricLine(
      { kind: 'lyric', text: '', chords: [{ chord: 'G', pos: 0 }] },
      4,
    )

    expect(rows).toEqual([
      {
        text: '',
        chords: [{ chord: 'G', pos: 0, originalIndex: 0 }],
        start: 0,
      },
    ])
  })
})
