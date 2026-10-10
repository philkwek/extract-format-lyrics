import { isChord } from './chords.js'
import type { RawExtractedSong, RawPositionedChord, RawPositionedWord } from './extractSheet.js'

export type PdfPageClassification = 'digital' | 'scanned' | 'hybrid' | 'uncertain'

export interface PositionedPdfText {
  text: string
  x0: number
  x1: number
  y: number
  height: number
}

export interface NormalizedPdfRow {
  text: string
  items: PositionedPdfText[]
  x0: number
  x1: number
  y: number
  column: 'left' | 'right'
}

export interface PdfPageAnalysis {
  classification: PdfPageClassification
  rows: NormalizedPdfRow[]
  diagnostics: string[]
  hasImages: boolean
}

const meaningfulCharacters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '')

export function classifyPdfText(items: PositionedPdfText[], hasImages: boolean): Pick<PdfPageAnalysis, 'classification' | 'diagnostics'> {
  const allText = items.map((item) => item.text).join(' ')
  const compact = meaningfulCharacters(allText)
  const printableRatio = allText ? compact.length / allText.replace(/\s/g, '').length : 0
  const diagnostics = [`${compact.length} meaningful text characters`, `${items.length} text items`]
  if (compact.length === 0) {
    if (allText.trim()) {
      diagnostics.push('Text layer is likely garbled')
      return { classification: 'uncertain', diagnostics }
    }
    return { classification: 'scanned', diagnostics }
  }
  if (printableRatio < 0.45) {
    diagnostics.push('Text layer is likely garbled')
    return { classification: 'uncertain', diagnostics }
  }
  if (compact.length < 30 || items.length < 3) {
    diagnostics.push('Text layer is too sparse for deterministic parsing')
    return { classification: hasImages ? 'hybrid' : 'uncertain', diagnostics }
  }
  return { classification: 'digital', diagnostics }
}

/** Extracts text geometry from the one-page PDFs produced by the upload client. */
export async function analyzePdfPage(data: Uint8Array): Promise<PdfPageAnalysis> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const document = await pdfjs.getDocument({ data } as Parameters<typeof pdfjs.getDocument>[0]).promise
    if (document.numPages !== 1) {
      await document.destroy()
      return { classification: 'uncertain', rows: [], diagnostics: ['Expected exactly one PDF page'], hasImages: false }
    }

    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const items = textContent.items
      .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item)
      .map((item) => {
        const x0 = item.transform[4]
        const y = item.transform[5]
        const width = Math.max(item.width, 0)
        const height = Math.max(item.height, Math.abs(item.transform[3]), 1)
        return { text: item.str, x0, x1: x0 + width, y, height }
      })
      .filter((item) => item.text.trim())

    let hasImages = false
    try {
      const operators = await page.getOperatorList()
      hasImages = operators.fnArray.some((operation) =>
        operation === pdfjs.OPS.paintImageXObject || operation === pdfjs.OPS.paintImageMaskXObject
      )
    } catch {
      // Image inspection is only a tie-breaker; selectable text remains authoritative.
    }
    await document.destroy()

    const rows = normalizeRows(items, viewport.width)
    return { ...classifyPdfText(items, hasImages), rows, hasImages }
  } catch (error) {
    return {
      classification: 'uncertain',
      rows: [],
      diagnostics: [`PDF text extraction failed: ${(error as Error).message || 'unknown error'}`],
      hasImages: false,
    }
  }
}

/**
 * Two-column SongSelect charts have simultaneous rows separated by a consistent, wide gutter.
 * A single-column lyric can legitimately cross the page midpoint, so its presence on both sides
 * is not enough to call it two-column.
 */
function hasTwoColumnLayout(groups: PositionedPdfText[][], pageWidth: number): boolean {
  let splitRows = 0
  for (const group of groups) {
    const left = group.filter((item) => (item.x0 + item.x1) / 2 < pageWidth * 0.5)
    const right = group.filter((item) => (item.x0 + item.x1) / 2 >= pageWidth * 0.5)
    if (left.length === 0 || right.length === 0) continue
    const gutter = Math.min(...right.map((item) => item.x0)) - Math.max(...left.map((item) => item.x1))
    if (gutter >= pageWidth * 0.16) splitRows += 1
  }
  // Requiring two independent baselines avoids treating a title row or a large word gap as columns.
  return splitRows >= 2
}

function cleanChordFragment(text: string): string {
  let cleaned = text.replace(/^[|:\[]+|[|:\]]+$/g, '').trim()
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) return cleaned.slice(1, -1)
  if (cleaned.startsWith('(')) cleaned = cleaned.slice(1)
  if (!cleaned.includes('(') && cleaned.endsWith(')')) cleaned = cleaned.slice(0, -1)
  return cleaned
}

function isChordModifierFragment(text: string): boolean {
  const fragment = cleanChordFragment(text)
  return /^(?:\d+(?:\([^)]*\))?|[#b]\d+|maj|min|sus|add|no|m|M|dim|aug|[+\-°ø])$/i.test(fragment)
}

function superscriptsBelongToChordGroup(modifiers: PositionedPdfText[], candidate: PositionedPdfText[]): boolean {
  // PDF.js can combine a complete bar ("| G D/F# | Bm A") into one text item.
  // Recover approximate token bounds so a superscript can still find the final
  // `A` or `G` instead of requiring one PDF item per chord.
  const roots = candidate.flatMap((item) => {
    const tokens = item.text.trim().split(/\s+/).filter(Boolean)
    const tokenWidth = (item.x1 - item.x0) / Math.max(tokens.length, 1)
    return tokens.map((text, index) => ({
      ...item,
      text,
      x0: item.x0 + tokenWidth * index,
      x1: item.x0 + tokenWidth * (index + 1),
    }))
  }).filter((item) => isChord(cleanChordFragment(item.text)))
  if (roots.length === 0) return false

  // A SongSelect superscript begins immediately at the end of its chord root
  // (e.g. `Em` + raised `7`). Matching this geometry avoids attaching a raised
  // number to the lyric row that happens to be closer in the PDF reading order.
  return modifiers.every((modifier) => roots.some((root) => {
    const gap = modifier.x0 - root.x1
    return gap >= -1 && gap <= Math.max(4, root.height * 0.45)
  }))
}

/**
 * PDFs often put superscripts (Em⁷, G²(no3), A⁽⁴⁾) on a separate text baseline.
 * Fold a nearby modifier-only baseline into the chord roots immediately below it before
 * converting either row into a chart line.
 */
function mergeSuperscriptModifierGroups(groups: PositionedPdfText[][]): PositionedPdfText[][] {
  const sorted = groups.sort((a, b) => b[0].y - a[0].y)
  for (const group of sorted) {
    // PDF text extraction may list a same-height lyric row between a chord root
    // and its superscript, particularly in two-column exports. A superscript
    // can even be grouped with an unrelated neighbouring lyric baseline, so
    // peel modifier glyphs out one-by-one before finding their chord root.
    for (const modifier of [...group].filter((item) => isChordModifierFragment(item.text))) {
      // It may already share a group with its chord root. Once attached, it is
      // authoritative: do not let a later pass pull it toward another nearby
      // row that happens to use the same horizontal position.
      if (superscriptsBelongToChordGroup([modifier], group)) continue
      const target = sorted
        .filter((candidate) => candidate !== group)
        .filter((candidate) => candidate.length > 0 && Math.abs(candidate[0].y - group[0].y) <= 24)
        .filter((candidate) => superscriptsBelongToChordGroup([modifier], candidate))
        .sort((a, b) => Math.abs(a[0].y - group[0].y) - Math.abs(b[0].y - group[0].y))[0]

      if (!target) continue
      group.splice(group.indexOf(modifier), 1)
      target.push(modifier)
    }
  }
  return sorted.filter((group) => group.length > 0)
}

/** Groups PDF glyph runs into visual rows and preserves either one-column or two-column reading order. */
export function normalizeRows(items: PositionedPdfText[], pageWidth: number): NormalizedPdfRow[] {
  const groups: PositionedPdfText[][] = []
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
    const existing = groups.find((group) => Math.abs(group[0].y - item.y) <= Math.max(3, Math.min(group[0].height, item.height) * 0.55))
    if (existing) existing.push(item)
    else groups.push([item])
  }

  const mergedGroups = mergeSuperscriptModifierGroups(groups)
  const isTwoColumn = hasTwoColumnLayout(mergedGroups, pageWidth)
  const left: NormalizedPdfRow[] = []
  const right: NormalizedPdfRow[] = []
  for (const group of mergedGroups) {
    if (!isTwoColumn) {
      const sorted = group.sort((a, b) => a.x0 - b.x0)
      left.push({
        text: sorted.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
        items: sorted,
        x0: Math.min(...sorted.map((item) => item.x0)),
        x1: Math.max(...sorted.map((item) => item.x1)),
        y: sorted[0].y,
        column: 'left',
      })
      continue
    }
    const columns = {
      left: group.filter((item) => (item.x0 + item.x1) / 2 < pageWidth * 0.5),
      right: group.filter((item) => (item.x0 + item.x1) / 2 >= pageWidth * 0.5),
    }
    for (const column of ['left', 'right'] as const) {
      if (columns[column].length === 0) continue
      const sorted = columns[column].sort((a, b) => a.x0 - b.x0)
      const row: NormalizedPdfRow = {
        text: sorted.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
        items: sorted,
        x0: Math.min(...sorted.map((item) => item.x0)),
        x1: Math.max(...sorted.map((item) => item.x1)),
        y: sorted[0].y,
        column,
      }
      ;(column === 'left' ? left : right).push(row)
    }
  }
  return [...left.sort((a, b) => b.y - a.y), ...right.sort((a, b) => b.y - a.y)]
}

const isFooter = (text: string) => /(?:©|\(c\)|copyright|all rights reserved|ccli\s*(?:licen[cs]e|song|#)?|used by permission|published by|administered by|integrity['’]s praise|open hands music|little way creative|page \d+)/i.test(text)
const sectionType = (text: string): RawExtractedSong['sections'][number]['type'] | null => {
  const normalized = text.replace(/[\[\]()]/g, '').trim().toLowerCase()
  if (/^verse(?:\s+\d+)?$/.test(normalized)) return 'Verse'
  if (/^pre[- ]?chorus(?:\s+\d+)?$/.test(normalized)) return 'Pre-Chorus'
  if (/^chorus(?:\s+\d+)?$/.test(normalized)) return 'Chorus'
  if (/^bridge(?:\s+\d+)?$/.test(normalized)) return 'Bridge'
  if (/^intro$/.test(normalized)) return 'Intro'
  if (/^(?:ending|outro)$/.test(normalized)) return 'Outro'
  if (/^(?:instrumental|interlude|turnaround)(?:\s*[-:]?\s*\d+[a-z]?)?$/.test(normalized)) return 'Instrumental'
  return null
}

function rowWords(row: NormalizedPdfRow): RawPositionedWord[] {
  return row.items.flatMap((item) => {
    const tokens = item.text.trim().split(/\s+/).filter(Boolean)
    const width = (item.x1 - item.x0) / Math.max(tokens.length, 1)
    return tokens.map((text, index) => ({ text, x0: item.x0 + width * index, x1: item.x0 + width * (index + 1) }))
  })
}

function rowChords(row: NormalizedPdfRow): RawPositionedChord[] {
  return rowWords(row).filter((word) => isChord(word.text)).map((word) => ({ chord: word.text, x0: word.x0, x1: word.x1 }))
}

function isChordRow(row: NormalizedPdfRow): boolean {
  const words = rowWords(row)
  const chordCount = words.filter((word) => isChord(word.text.replace(/^[|:()[\]]+|[|:()[\]]+$/g, ''))).length
  return chordCount > 0 && chordCount / Math.max(words.length, 1) >= 0.75
}

function titleFromRows(rows: NormalizedPdfRow[]): string | null {
  const candidate = rows.find((row) => {
    const text = row.text.trim()
    return text.length >= 3 && !isFooter(text) && !sectionType(text) && !isChordRow(row) && !/^(?:key|tempo|time|words and music|ccli)\b/i.test(text)
  })
  // SongSelect continuation pages use "Title - 2". Preserve the original song identity so
  // mergeConsecutiveSongs joins the page instead of creating a second song.
  return candidate?.text.replace(/\s*[-–]\s*\d+\s*$/, '') || null
}

/** Parses the structured SongSelect text layout. Null means the caller should use the vision fallback. */
export function parseDigitalSongSelectPage(analysis: PdfPageAnalysis): { song?: RawExtractedSong; reason?: string } {
  if (analysis.classification !== 'digital') return { reason: `Page is ${analysis.classification}` }
  const rows = analysis.rows.filter((row) => !isFooter(row.text))
  const title = titleFromRows(rows)
  if (!title) return { reason: 'Could not identify a SongSelect title' }

  const sections: RawExtractedSong['sections'] = []
  let current: RawExtractedSong['sections'][number] = { type: 'Other', label: 'Song', lines: [] }
  const flush = () => { if (current.lines.length > 0) sections.push(current) }
  let bodyRows = 0
  let hasSongSelectStructure = false
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const normalizedRowTitle = row.text.replace(/\s*[-–]\s*\d+\s*$/, '')
    if (normalizedRowTitle === title || /^(?:key|tempo|time|words and music|ccli)\b/i.test(row.text)) continue
    const type = sectionType(row.text)
    if (type) {
      hasSongSelectStructure = true
      flush()
      current = { type, label: row.text.replace(/[\[\]]/g, '').trim(), lines: [] }
      continue
    }
    if (isChordRow(row)) {
      hasSongSelectStructure = true
      const next = rows[index + 1]
      if (next && !sectionType(next.text) && !isFooter(next.text) && !isChordRow(next)) {
        current.lines.push({ kind: 'lyric', words: rowWords(next), positionedChords: rowChords(row) })
        bodyRows += 2
        index += 1
      } else {
        current.lines.push({ kind: 'chords-only', content: row.text })
        bodyRows += 1
      }
      continue
    }
    if (rowWords(row).length > 0) {
      current.lines.push({ kind: 'lyric', words: rowWords(row), positionedChords: [] })
      bodyRows += 1
    }
  }
  flush()
  if (sections.length === 0 || bodyRows < 2 || !hasSongSelectStructure) {
    return { reason: 'Too little SongSelect chart structure for a reliable deterministic import' }
  }

  const key = rows.map((row) => row.text.match(/\bkey\s*[:=-]?\s*([A-G](?:#|b)?(?:m|min)?)/i)?.[1]).find(Boolean)
  return { song: { title, originalKey: key || null, sections } }
}
