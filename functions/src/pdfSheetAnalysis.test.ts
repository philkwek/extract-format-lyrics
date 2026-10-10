import { describe, expect, it } from 'vitest'
import {
  analyzePdfPage,
  classifyPdfText,
  normalizeRows,
  parseDigitalSongSelectPage,
  type PositionedPdfText,
} from './pdfSheetAnalysis.js'

const item = (text: string, x0: number, y: number, width = 80): PositionedPdfText => ({
  text,
  x0,
  x1: x0 + width,
  y,
  height: 12,
})

describe('PDF page classification', () => {
  it('classifies substantial selectable text as digital even when it contains an image', () => {
    const result = classifyPdfText([
      item('Amazing Grace', 50, 700),
      item('How sweet the sound that saved a wretch like me', 50, 650, 260),
      item('I once was lost but now am found', 50, 620, 200),
    ], true)
    expect(result.classification).toBe('digital')
  })

  it('distinguishes scanned, hybrid, and garbled text layers', () => {
    expect(classifyPdfText([], true).classification).toBe('scanned')
    expect(classifyPdfText([item('Title', 50, 700)], true).classification).toBe('hybrid')
    expect(classifyPdfText([item('/// --- ...', 50, 700), item('///', 50, 650), item('---', 50, 620)], false).classification).toBe('uncertain')
  })

  it('reports unreadable PDF data as uncertain instead of throwing', async () => {
    await expect(analyzePdfPage(Uint8Array.from([0, 1, 2, 3]))).resolves.toMatchObject({ classification: 'uncertain' })
  })
})

describe('SongSelect deterministic parser', () => {
  it('merges a superscript-only PDF row into the chord roots beneath it', () => {
    const rows = normalizeRows([
      item('7', 72, 708, 7), item('2', 162, 708, 7),
      item('Em', 50, 700, 20), item('G', 150, 700, 10),
      item('Let it rise like incense', 50, 670, 180),
    ], 600)

    expect(rows.map((row) => row.text)).toEqual(['Em 7 G 2', 'Let it rise like incense'])
  })

  it('matches superscripts to chord geometry when an intervening lyric row is closer', () => {
    const rows = normalizeRows([
      item('7', 72, 708, 7), item('2', 162, 708, 7),
      item('A lyric row that is not chords', 50, 710, 180),
      item('Em', 50, 700, 20), item('G', 150, 700, 10),
    ], 600)

    expect(rows.map((row) => row.text)).toContain('Em 7 G 2')
    expect(rows.map((row) => row.text)).toContain('A lyric row that is not chords')
  })

  it('keeps already-attached modifiers stable while merging a higher instrumental modifier row', () => {
    const rows = normalizeRows([
      item('7', 72, 724, 7), item('7', 178, 724, 7),
      item('Em', 50, 704, 20), item('Cmaj', 150, 704, 28),
      item('2', 60, 660, 7), item('(4)', 160, 660, 12),
      item('G', 50, 640, 10), item('A', 150, 640, 10),
    ], 600)

    expect(rows.map((row) => row.text)).toEqual(['Em 7 Cmaj 7', 'G 2 A (4)'])
  })

  it('matches a superscript to a chord root embedded with a barline glyph', () => {
    const rows = normalizeRows([
      item('2', 76, 704, 7), item('(4)', 156, 704, 12),
      item('| G', 50, 700, 26), item('D/F# | Bm A', 100, 700, 90),
    ], 600)

    expect(rows.map((row) => row.text)).toEqual(['| G 2 D/F# | Bm A (4)'])
  })

  it('keeps a single-column chart row intact when lyrics cross the page midpoint', () => {
    const rows = normalizeRows([
      item('Great Are You Lord', 40, 700, 220),
      item('You give life You are love', 50, 620, 380),
      item('You bring light to the darkness', 500, 620, 320),
      item('You give hope You restore', 50, 580, 350),
      item("ev'ry heart that is broken", 460, 580, 320),
    ], 1000)

    expect(rows).toHaveLength(3)
    expect(rows[1].text).toBe('You give life You are love You bring light to the darkness')
    expect(rows[2].text).toBe("You give hope You restore ev'ry heart that is broken")
  })

  it('retains column-by-column reading order when repeated rows have a wide central gutter', () => {
    const rows = normalizeRows([
      item('Left one', 50, 700, 180), item('Right one', 720, 700, 180),
      item('Left two', 50, 650, 180), item('Right two', 720, 650, 180),
    ], 1000)

    expect(rows.map((row) => row.text)).toEqual(['Left one', 'Left two', 'Right one', 'Right two'])
  })

  it('reconstructs rows, section labels, and chord-to-lyric geometry', () => {
    const items = [
      item('Amazing Grace', 50, 700, 120),
      item('Verse 1', 50, 670, 60),
      item('G', 50, 640, 10),
      item('D', 150, 640, 10),
      item('Amazing grace how sweet the sound', 50, 620, 220),
      item('G', 50, 590, 10),
      item('D', 180, 590, 10),
      item('That saved a wretch like me', 50, 570, 190),
    ]
    const rows = normalizeRows(items, 600)
    const parsed = parseDigitalSongSelectPage({ classification: 'digital', rows, diagnostics: [], hasImages: false })

    expect(parsed.reason).toBeUndefined()
    expect(parsed.song?.title).toBe('Amazing Grace')
    expect(parsed.song?.sections).toHaveLength(1)
    expect(parsed.song?.sections[0].type).toBe('Verse')
    const line = parsed.song?.sections[0].lines[0]
    expect(line?.kind).toBe('lyric')
    if (line?.kind === 'lyric') {
      expect(line.words?.[0]).toMatchObject({ text: 'Amazing', x0: 50 })
      expect(line.positionedChords).toEqual([{ chord: 'G', x0: 50, x1: 60 }, { chord: 'D', x0: 150, x1: 160 }])
    }
  })

  it('parses an ENDING continuation page and normalizes its title for page merging', () => {
    const rows = normalizeRows([
      item('Indescribable - 2', 50, 700, 160),
      item('ENDING', 50, 660, 60),
      item('G', 50, 630, 10),
      item('2', 62, 630, 8),
      item('You see the depths of my heart', 90, 610, 220),
      item('Bm', 50, 580, 18),
      item('7', 70, 580, 8),
      item('And You love me the same', 90, 560, 190),
    ], 600)
    const parsed = parseDigitalSongSelectPage({ classification: 'digital', rows, diagnostics: [], hasImages: false })

    expect(parsed.reason).toBeUndefined()
    expect(parsed.song?.title).toBe('Indescribable')
    expect(parsed.song?.sections[0].type).toBe('Outro')
    expect(parsed.song?.sections[0].label).toBe('ENDING')
  })

  it('rejects a page with a title but too little chart content', () => {
    const rows = normalizeRows([item('Short Chart', 50, 700), item('G', 50, 650, 10)], 600)
    expect(parseDigitalSongSelectPage({ classification: 'digital', rows, diagnostics: [], hasImages: false }).reason).toContain('Too little')
  })
})
