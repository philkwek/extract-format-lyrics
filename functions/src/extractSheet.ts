import { GoogleGenAI, Type } from '@google/genai'
import type { Song, Section, SectionType, Line, ChordPlacement } from './types.js'
import { isChord } from './chords.js'
import { analyzePdfPage, parseDigitalSongSelectPage, type PdfPageAnalysis } from './pdfSheetAnalysis.js'

export interface RawPositionedWord {
  text: string
  /** Left edge, 0-1000 (fraction of page width) */
  x0: number
  /** Right edge, 0-1000 */
  x1: number
}

export interface RawPositionedChord {
  chord: string
  x0: number
  x1?: number
}

export interface RawExtractedLine {
  kind: 'lyric' | 'chords-only'
  words?: RawPositionedWord[] | null
  positionedChords?: RawPositionedChord[] | null
  chordLine?: string | null
  lyricLine?: string | null
  content?: string | null
}

export interface RawExtractedSection {
  type: SectionType
  label: string
  lines: RawExtractedLine[]
}

export interface RawExtractedSong {
  title: string
  artist?: string
  originalKey?: string | null
  tempo?: string | null
  timeSignature?: string | null
  ccliNumber?: string | null
  sections: RawExtractedSection[]
}

export interface RawExtractionResponse {
  songs: RawExtractedSong[]
}

export interface SheetFilePart {
  mimeType: string
  /** Base64-encoded file data */
  base64Data: string
}

export interface ExtractionProgress {
  type: 'analyzing' | 'page-route' | 'deterministic' | 'batch' | 'retrying' | 'merging'
  expectedSongCount?: number
  extractedSongCount?: number
  batchStartPage?: number
  batchEndPage?: number
  pageIndex?: number
  classification?: PdfPageAnalysis['classification'] | 'image'
  route?: 'deterministic' | 'gemini'
  diagnostic?: string
}

export interface ExtractionOptions {
  expectedSongCount?: number
  onProgress?: (progress: ExtractionProgress) => void
}

export class ExpectedSongCountMismatchError extends Error {
  constructor(expectedSongCount: number, extractedSongCount: number) {
    super(
      `Could not reliably extract all ${expectedSongCount} songs. The final check found ${extractedSongCount}. Please try uploading the sheets as separate files.`
    )
    this.name = 'ExpectedSongCountMismatchError'
  }
}

export function isExpectedSongCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

export function needsSongCountRetry(expectedSongCount: number | undefined, extractedSongCount: number): boolean {
  return expectedSongCount !== undefined && extractedSongCount !== expectedSongCount
}

export function mergeConsecutiveSongs(songs: RawExtractedSong[]): RawExtractedSong[] {
  return songs.reduce<RawExtractedSong[]>((merged, song) => {
    const previous = merged.at(-1)
    if (previous && previous.title.trim().toLowerCase() === song.title.trim().toLowerCase()) {
      previous.sections.push(...song.sections)
    } else {
      merged.push(song)
    }
    return merged
  }, [])
}

export const songSelectResponseSchema = {
  type: Type.OBJECT,
  properties: {
    songs: {
      type: Type.ARRAY,
      description: 'List of songs extracted from the document or images',
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          artist: { type: Type.STRING },
          originalKey: { type: Type.STRING },
          tempo: { type: Type.STRING },
          timeSignature: { type: Type.STRING },
          ccliNumber: { type: Type.STRING },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  enum: [
                    'Intro',
                    'Verse',
                    'Pre-Chorus',
                    'Chorus',
                    'Bridge',
                    'Outro',
                    'Instrumental',
                    'Other',
                  ],
                },
                label: { type: Type.STRING },
                lines: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      kind: { type: Type.STRING, enum: ['lyric', 'chords-only'] },
                      words: {
                        type: Type.ARRAY,
                        description:
                          'For lyric lines: every printed lyric token left-to-right with its horizontal bounds (0-1000 = fraction of page width). Split words keep separate tokens, e.g. "a", "-", "way".',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            text: { type: Type.STRING },
                            x0: { type: Type.NUMBER, description: 'Left edge, 0-1000' },
                            x1: { type: Type.NUMBER, description: 'Right edge, 0-1000' },
                          },
                          required: ['text', 'x0', 'x1'],
                        },
                      },
                      positionedChords: {
                        type: Type.ARRAY,
                        description:
                          'For lyric lines: every chord printed above the lyric with its horizontal bounds (0-1000). Include chords left of the first word (timing rests).',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            chord: { type: Type.STRING, description: 'e.g. "Asus", "D2", "Bm7", "A/C#"' },
                            x0: { type: Type.NUMBER, description: 'Left edge, 0-1000' },
                            x1: { type: Type.NUMBER, description: 'Right edge, 0-1000' },
                          },
                          required: ['chord', 'x0', 'x1'],
                        },
                      },
                      content: {
                        type: Type.STRING,
                        description: 'For chords-only lines: bar line, e.g. "| A | A | Bm7 | Bm7 |". Not used for lyric lines.',
                      },
                    },
                    required: ['kind'],
                  },
                },
              },
              required: ['type', 'label', 'lines'],
            },
          },
        },
        required: ['title', 'sections'],
      },
    },
  },
  required: ['songs'],
}

export const SONGSELECT_SYSTEM_PROMPT = `
You are an expert music chart transcriber specializing in SongSelect (CCLI) chord charts.
Your job is to transcribe the provided sheet document or images with 100% layout, whitespace, and musical alignment fidelity.

CRITICAL RULES FOR SONGSELECT FORMAT:

1. PAGE LAYOUT (ONE OR TWO COLUMNS):
   - SongSelect charts may use either one full-width vertical column or two vertical columns per page.
   - First inspect the page for a repeated, clearly empty central gutter. Only then treat it as two columns.
   - For a one-column chart, read every row from top to bottom across the full page width. Never split a single lyric or chord row at the page midpoint.
   - For a true two-column chart, read Column 1 completely from top-to-bottom first, then Column 2 completely from top-to-bottom.
   - Never interleave rows between two columns, and never invent columns where the text simply spans a wide page.

2. CHORD-TO-WORD ALIGNMENT BY GEOMETRY (CRITICAL):
   - For every LYRIC line, return 'words' and 'positionedChords' with HORIZONTAL POSITIONS.
   - Coordinates are integers 0-1000 = left-to-right fraction of the FULL PAGE/IMAGE width (0 = left edge, 1000 = right edge). Use the same scale for every line on the page.
   - 'words': every printed lyric token in left-to-right order, each with x0 (left edge) and x1 (right edge) of that token as printed. Keep hyphens/dashes of split words ("a", "-", "way") as separate tokens, exactly as printed. Do not merge or drop words.
   - 'positionedChords': every chord printed on the line directly ABOVE the lyric, each with x0 and x1 (left/right edge of the chord symbol). Superscripts are part of the chord: "A" with superscript "sus" = "Asus", "D" with superscript "2" = "D2", "Bm" with superscript "7" = "Bm7".
   - Measure x from the actual pixels. Do NOT guess alignment from musical logic. A chord belongs to whichever word is physically beneath it; a chord can be beneath the START of a word, the middle of a word, or a gap.
   - Never put chords inside the lyric text. Never use bracket syntax. Never use spaces to position anything.

3. INSTRUMENTAL TIMING (CRITICAL):
   - A chord can be printed to the LEFT of where the lyrics begin (e.g. "F#m7" at far left while "Heaven is trembling" starts further right). Report its true x0/x1 and the true x0 of the first word. Do not move it onto the first word; the app preserves the rest.
   - A chord can also be printed after the last word or in a gap far from any word. Report its true x position.

4. INSTRUMENTALS & CHORDS-ONLY:
   - For instrumental sections or lines consisting only of chord bars (e.g. Intro, Instrumental like '| A | A | Bm7 | Bm7 |'):
     * kind: 'chords-only'
     * content: '| A | A | Bm7 | Bm7 |'

5. MULTI-PAGE & MULTI-SONG:
   - Merge continuation pages (e.g. 'Page 2 of 2' or '[Title] - 2') into the current song in order.
   - Separate distinct songs if a new header (new Title, Key, CCLI #) appears.

6. METADATA:
   - Extract 'title', 'artist' (from 'Words and Music by...'), 'originalKey', 'tempo', 'timeSignature', 'ccliNumber'.

7. STRIP FOOTERS:
   - Omit CCLI license numbers, copyright notices, and page numbers at the bottom of the page.
`.trim()

/**
 * Extracts chords and their exact character positions from a spaced chord line.
 */
export function extractChordsFromSpacedLine(chordLine: string): ChordPlacement[] {
  const chords: ChordPlacement[] = []
  const regex = /\S+/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(chordLine)) !== null) {
    const rawToken = match[0]
    const cleanToken = rawToken.replace(/^[|:()[\]]+|[|:()[\]]+$/g, '')
    if (cleanToken && isChord(cleanToken)) {
      const innerOffset = rawToken.indexOf(cleanToken)
      chords.push({
        pos: match.index + (innerOffset >= 0 ? innerOffset : 0),
        chord: cleanToken,
      })
    }
  }

  return chords
}

/**
 * Parses bracketed notation like "[Asus]Found in Your [A]hands" into the app's Line data model.
 * Preserves leading whitespace and guarantees chords never collide.
 */
export function bracketedLineToModelLine(kind: 'lyric' | 'chords-only', content: string): Line {
  if (kind === 'chords-only') {
    const tokens = content.match(/[A-G][b#]?(?:maj|min|m|M|sus|aug|dim|add|[0-9])*(?:\/[A-G][b#]?)?/g) || []
    const validChords = tokens.filter((t) => isChord(t))
    if (validChords.length > 0) {
      return { kind: 'chords-only', chords: validChords }
    }
    return { kind: 'chords-only', chords: content.trim() ? [content.trim()] : [] }
  }

  const chords: ChordPlacement[] = []
  let cleanText = ''
  let i = 0
  let minChordPos = 0

  while (i < content.length) {
    if (content[i] === '[') {
      const closeIdx = content.indexOf(']', i)
      if (closeIdx !== -1) {
        const chordCandidate = content.slice(i + 1, closeIdx).trim()
        if (chordCandidate && isChord(chordCandidate)) {
          const pos = Math.max(cleanText.length, minChordPos)
          chords.push({
            pos,
            chord: chordCandidate,
          })
          minChordPos = pos + chordCandidate.length + 1
          i = closeIdx + 1
          continue
        }
      }
    }
    cleanText += content[i]
    i++
  }

  // Ensure cleanText is padded with spaces if chords extend past the end of the line
  const maxChordEnd = chords.reduce((max, c) => Math.max(max, c.pos + c.chord.length), 0)
  if (maxChordEnd > cleanText.length) {
    cleanText = cleanText.padEnd(maxChordEnd, ' ')
  }

  return {
    kind: 'lyric',
    text: cleanText,
    chords,
  }
}

/**
 * The vision model can correctly read a chord row while labelling it as a lyric row.
 * Treat a row made solely of valid chord symbols (plus bar separators) as chords-only
 * before it reaches the lyric rendering path.
 */
interface ChordFragment {
  text: string
  x0: number
  x1: number
}

function cleanChordFragment(text: string): string {
  let cleaned = text.replaceAll('[', '').replaceAll(']', '').replace(/^[|:]+|[|:]+$/g, '').trim()
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) return cleaned.slice(1, -1)
  if (cleaned.startsWith('(')) cleaned = cleaned.slice(1)
  // Keep the closing parenthesis in chord qualities such as G2(no3).
  if (!cleaned.includes('(') && cleaned.endsWith(')')) cleaned = cleaned.slice(0, -1)
  return cleaned
}

function isChordAnnotation(text: string): boolean {
  // SongSelect uses parenthesized repeat/cue notes beside an otherwise chord-only row,
  // e.g. "(1.)", "(Last x)", and "(To Interlude 1a)".
  return /^(?:\d+[a-z]?\.?|last|x\d*|repeat|times?|tacet|to|interlude|intro|verse|chorus|bridge|ending|outro|tag)$/i.test(cleanChordFragment(text))
}

/** Rejoins chord qualities that a PDF text layer separates from their root/superscript. */
function parseChordFragments(fragments: ChordFragment[]): { chords: RawPositionedChord[]; isChordOnly: boolean } {
  const chords: RawPositionedChord[] = []
  const leftovers: string[] = []
  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index]
    let candidate = cleanChordFragment(fragment.text)
    if (!candidate) continue
    let end = index

    // Prefer a valid joined chord (A + sus, G + 2, Em + 11) over its valid root alone.
    for (let next = index + 1; next < fragments.length; next += 1) {
      const suffix = cleanChordFragment(fragments[next].text)
      if (!suffix) {
        end = next
        continue
      }
      const joined = candidate + suffix
      if (!isChord(joined)) break
      candidate = joined
      end = next
    }

    if (isChord(candidate)) {
      chords.push({ chord: candidate, x0: fragment.x0, x1: fragments[end].x1 })
      index = end
    } else {
      leftovers.push(candidate)
    }
  }
  return { chords, isChordOnly: chords.length > 0 && leftovers.every(isChordAnnotation) }
}

function chordOnlyModelLine(content: string): Line | null {
  if (!content.trim()) return null
  const fragments = [...content.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    x0: match.index ?? 0,
    x1: (match.index ?? 0) + match[0].length,
  }))
  const parsed = parseChordFragments(fragments)
  if (!parsed.isChordOnly) return null
  return { kind: 'chords-only', chords: parsed.chords.map((chord) => chord.chord) }
}

/**
 * Builds a lyric Line from geometry reported by the vision model.
 * Each word and chord carries horizontal bounds (0-1000, fraction of page width).
 * Every x-coordinate is mapped independently into monospace character space, preserving
 * each line's own leading indent and the variable gaps between its words and chords.
 */
export function positionedLineToModelLine(
  words: RawPositionedWord[],
  chordItems: RawPositionedChord[]
): Line {
  const ws = words
    .filter((w) => w.text && w.text.trim())
    .map((w) => ({ text: w.text.trim(), x0: w.x0, x1: Math.max(w.x1, w.x0) }))
    .sort((a, b) => a.x0 - b.x0)
  const cs = chordItems
    .filter((c) => c.chord && isChord(c.chord.trim()))
    .map((c) => ({ chord: c.chord.trim(), x0: c.x0, x1: Math.max(c.x1 ?? c.x0, c.x0) }))
    .sort((a, b) => a.x0 - b.x0)

  if (ws.length === 0) {
    return { kind: 'lyric', text: '', chords: cs.map((c, i) => ({ pos: i === 0 ? 0 : 0, chord: c.chord })) }
  }

  const totalChars = ws.reduce((n, w) => n + w.text.length, 0)
  const totalWidth = ws.reduce((n, w) => n + (w.x1 - w.x0), 0)
  const charWidth = totalChars > 0 && totalWidth > 0 ? totalWidth / totalChars : 8
  const origin = Math.min(ws[0].x0, ...cs.map((chord) => chord.x0))
  let text = ''
  const starts: number[] = []
  for (const word of ws) {
    const geometricStart = Math.max(0, Math.round((word.x0 - origin) / charWidth))
    const start = text.length === 0 ? geometricStart : Math.max(geometricStart, text.length + 1)
    starts.push(start)
    text = text.padEnd(start) + word.text
  }
  const chords: ChordPlacement[] = cs.map((chord) => {
    const centre = (chord.x0 + chord.x1) / 2
    if (centre < ws[0].x0 - charWidth * 0.5 && chord.x1 <= ws[0].x0 + charWidth * 0.5) {
      return { chord: chord.chord, pos: 0 }
    }
    // Repeat/outro chords can intentionally continue after the final lyric word.
    // Keep their physical x-position rather than collapsing them onto that last word.
    if (centre > ws.at(-1)!.x1 + charWidth * 0.5) {
      return { chord: chord.chord, pos: Math.max(0, Math.round((chord.x0 - origin) / charWidth)) }
    }
    let wordIndex = 0
    for (let index = 0; index < ws.length; index += 1) if (ws[index].x0 <= centre) wordIndex = index
    if (centre > ws[wordIndex].x1 && wordIndex + 1 < ws.length) wordIndex += 1
    return { chord: chord.chord, pos: starts[wordIndex] }
  })

  // Never let two chords share a position (keeps edit/delete addressable and visible)
  const seen = new Set<number>()
  for (const c of chords) {
    while (seen.has(c.pos)) c.pos += 1
    seen.add(c.pos)
  }
  const maxEnd = chords.reduce((m, c) => Math.max(m, c.pos + c.chord.length), 0)
  if (maxEnd > text.length) text = text.padEnd(maxEnd, ' ')

  return { kind: 'lyric', text, chords }
}

/**
 * Converts a raw extracted line into the app's Line data model.
 * Handles bracketed content (prioritized for syllable precision) or spaced chordLine + lyricLine.
 */
export function rawLineToModelLine(line: RawExtractedLine): Line {
  // Correct malformed/overly-generic vision output before trusting its declared kind.
  // `words` is the common shape when a scanned chord row was reported as a lyric row.
  const rawWords = line.words?.map((word) => word.text).join(' ') || ''
  const chordOnly = chordOnlyModelLine(line.content || line.chordLine || rawWords)
  if (chordOnly) return chordOnly

  if (line.kind === 'chords-only') {
    const rawText = line.content || line.chordLine || ''
    const tokens = rawText.match(/[A-G][b#]?(?:maj|min|m|M|sus|aug|dim|add|[0-9])*(?:\/[A-G][b#]?)?/g) || []
    const validChords = tokens.filter((t) => isChord(t))
    if (validChords.length > 0) {
      return { kind: 'chords-only', chords: validChords }
    }
    return { kind: 'chords-only', chords: rawText.trim() ? [rawText.trim()] : [] }
  }

  // Preferred: geometry-based alignment (words + chords with x positions)
  if (line.words && line.words.length > 0) {
    return positionedLineToModelLine(line.words, line.positionedChords || [])
  }

  // If bracketed notation is in content, use syllable-bound parsing
  if (line.content && /\[[A-G][^\]]*\]/.test(line.content)) {
    return bracketedLineToModelLine('lyric', line.content)
  }

  // Spaced chordLine and lyricLine mode (fallback)
  if (line.chordLine !== undefined || line.lyricLine !== undefined) {
    const chordLine = line.chordLine || ''
    const lyricLine = line.lyricLine || ''

    if (!chordLine.trim()) {
      return { kind: 'lyric', text: lyricLine, chords: [] }
    }

    const chords = extractChordsFromSpacedLine(chordLine)

    let text = lyricLine
    const maxChordPos = chords.reduce((max, c) => Math.max(max, c.pos + c.chord.length), 0)
    if (maxChordPos > text.length) {
      text = text.padEnd(maxChordPos, ' ')
    }

    return {
      kind: 'lyric',
      text,
      chords,
    }
  }

  return bracketedLineToModelLine('lyric', line.content || '')
}

/** Returns the scan-reported horizontal bounds for a chord row that was supplied as `words`. */
function chordItemsFromRawWords(words: RawPositionedWord[] | null | undefined): RawPositionedChord[] {
  const fragments = (words || []).flatMap((word) => {
    const tokens = word.text.trim().split(/\s+/).filter(Boolean)
    const width = (word.x1 - word.x0) / Math.max(tokens.length, 1)
    return tokens.map((text, index) => ({ text, x0: word.x0 + width * index, x1: word.x0 + width * (index + 1) }))
  })
  const parsed = parseChordFragments(fragments)
  return parsed.isChordOnly ? parsed.chords : []
}

/**
 * Repairs the common scanned-PDF shape of one all-chord row immediately followed by its lyric row.
 * This retains the extractor's x coordinates, allowing the chord editor to keep chords attached to
 * the words they appear above instead of showing a disconnected instrument line.
 */
function rawSectionToModelLines(lines: RawExtractedLine[]): Line[] {
  const result: Line[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    if (isSongSelectCreditLine(rawLineText(current))) continue
    const currentModel = rawLineToModelLine(current)
    const next = lines[index + 1]
    const nextModel = next ? rawLineToModelLine(next) : null
    const chordItems = chordItemsFromRawWords(current.words)

    if (
      currentModel.kind === 'chords-only' &&
      chordItems.length > 0 &&
      next &&
      nextModel?.kind === 'lyric' &&
      next.words &&
      next.words.length > 0 &&
      (!next.positionedChords || next.positionedChords.length === 0)
    ) {
      result.push(positionedLineToModelLine(next.words, chordItems))
      index += 1
      continue
    }
    result.push(currentModel)
  }
  return result
}

function rawLineText(line: RawExtractedLine): string {
  return line.content || line.lyricLine || line.chordLine || line.words?.map((word) => word.text).join(' ') || ''
}

/** Footer legal/publisher material is not chart content, even when a scan returns it as a lyric line. */
function isSongSelectCreditLine(text: string): boolean {
  return /(?:©|\(c\)|copyright|all rights reserved|used by permission|published by|administered by|ccli\s*(?:licen[cs]e|song|#)?|integrity['’]s praise|open hands music|little way creative)/i.test(text)
}

function sectionHeaderFromRawLine(line: RawExtractedLine): { type: SectionType; label: string } | null {
  const text = rawLineText(line).replaceAll('[', '').replaceAll(']', '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  if (!text || isSongSelectCreditLine(text)) return null
  const normalized = text.toLowerCase()
  if (/^verse(?:\s+\d+)?$/.test(normalized)) return { type: 'Verse', label: text }
  if (/^pre[- ]?chorus(?:\s+\d+)?$/.test(normalized)) return { type: 'Pre-Chorus', label: text }
  if (/^chorus(?:\s+\d+)?$/.test(normalized)) return { type: 'Chorus', label: text }
  if (/^bridge(?:\s+\d+)?$/.test(normalized)) return { type: 'Bridge', label: text }
  if (/^intro$/.test(normalized)) return { type: 'Intro', label: text }
  if (/^(?:ending|outro)$/.test(normalized)) return { type: 'Outro', label: text }
  if (/^(?:instrumental|interlude|turnaround)(?:\s*[-:]?\s*\d+[a-z]?)?$/.test(normalized)) {
    return { type: 'Instrumental', label: text }
  }
  return null
}

/** Splits incorrectly transcribed in-body section labels into actual app sections. */
function rawSectionsToAppSections(rawSections: RawExtractedSection[]): Section[] {
  const sections: Section[] = []
  for (const rawSection of rawSections) {
    let currentType = rawSection.type || 'Other'
    let currentLabel = rawSection.label || rawSection.type || 'Section'
    let currentLines: RawExtractedLine[] = []
    const flush = () => {
      const lines = rawSectionToModelLines(currentLines)
      if (lines.length > 0) sections.push({ type: currentType, label: currentLabel, lines })
      currentLines = []
    }
    for (const line of rawSection.lines || []) {
      const header = sectionHeaderFromRawLine(line)
      if (header) {
        flush()
        currentType = header.type
        currentLabel = header.label
      } else {
        currentLines.push(line)
      }
    }
    flush()
  }
  return sections
}

/**
 * Transforms the raw Gemini extraction result into full Song objects compatible with the application.
 */
export function transformRawSongsToAppSongs(rawSongs: RawExtractedSong[], sourceLabel = 'SongSelect Upload'): Song[] {
  return rawSongs.map((raw, idx) => {
    const songId = `upload-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`

    const sections = rawSectionsToAppSections(raw.sections || [])

    return {
      id: songId,
      title: raw.title?.trim() || 'Untitled Song',
      artist: raw.artist?.trim() || 'Unknown Artist',
      sourceUrl: `upload://${songId}`,
      sourceSite: sourceLabel,
      originalKey: raw.originalKey?.trim() || null,
      sections,
    }
  })
}

interface RoutedPage {
  index: number
  file: SheetFilePart
  analysis?: PdfPageAnalysis
  deterministicSong?: RawExtractedSong
}

interface VisionChunk {
  index: number
  pages: RoutedPage[]
}

function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, 'base64'))
}

function makeVisionChunks(pages: RoutedPage[]): VisionChunk[] {
  const chunks: VisionChunk[] = []
  for (const page of pages) {
    const previous = chunks.at(-1)
    if (previous && previous.pages.length < 2 && previous.pages.at(-1)!.index + 1 === page.index) {
      previous.pages.push(page)
    } else {
      chunks.push({ index: page.index, pages: [page] })
    }
  }
  return chunks
}

/**
 * Extracts SongSelect uploads using deterministic PDF text parsing where safe, and Gemini only for
 * scanned, hybrid, or low-confidence pages. The historical name is retained for the HTTP handler.
 */
export async function extractSongsWithGemini(
  files: SheetFilePart[],
  apiKey?: string,
  modelName: string = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  options: ExtractionOptions = {}
): Promise<Song[]> {
  options.onProgress?.({ type: 'analyzing', batchStartPage: 1, batchEndPage: files.length })
  const pages: RoutedPage[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (file.mimeType !== 'application/pdf') {
      console.info(`[extract-sheet] page ${index + 1}: image upload -> Gemini fallback`)
      options.onProgress?.({ type: 'page-route', pageIndex: index + 1, classification: 'image', route: 'gemini' })
      pages.push({ index, file })
      continue
    }
    const analysis = await analyzePdfPage(decodeBase64(file.base64Data))
    const parsed = parseDigitalSongSelectPage(analysis)
    if (parsed.song) {
      console.info(`[extract-sheet] page ${index + 1}: ${analysis.classification} PDF -> deterministic parser`)
      options.onProgress?.({
        type: 'page-route',
        pageIndex: index + 1,
        classification: analysis.classification,
        route: 'deterministic',
      })
      pages.push({ index, file, analysis, deterministicSong: parsed.song })
    } else {
      analysis.diagnostics.push(parsed.reason || 'Deterministic parsing was not confident')
      const diagnostic = analysis.diagnostics.at(-1)
      console.info(`[extract-sheet] page ${index + 1}: ${analysis.classification} PDF -> Gemini fallback (${diagnostic})`)
      options.onProgress?.({
        type: 'page-route',
        pageIndex: index + 1,
        classification: analysis.classification,
        route: 'gemini',
        diagnostic,
      })
      pages.push({ index, file, analysis })
    }
  }

  const deterministic = pages.filter((page) => page.deterministicSong)
  const fallbackPages = pages.filter((page) => !page.deterministicSong)
  if (deterministic.length > 0) {
    options.onProgress?.({ type: 'deterministic', batchStartPage: 1, batchEndPage: deterministic.length })
  }

  const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY
  if (fallbackPages.length > 0 && !resolvedApiKey) {
    const labels = fallbackPages.map((page) => {
      const reason = page.analysis?.diagnostics.at(-1) || 'image upload'
      return `page ${page.index + 1} (${reason})`
    })
    throw new Error(
      `Gemini is required for ${labels.join(', ')}. Add a Gemini API key or upload a selectable-text PDF.`
    )
  }

  const transcribe = async (batch: RoutedPage[], instruction: string): Promise<RawExtractionResponse> => {
    const ai = new GoogleGenAI({ apiKey: resolvedApiKey! })
    const contents: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = batch.map(
      ({ file }) => ({ inlineData: { mimeType: file.mimeType, data: file.base64Data } })
    )
    contents.push({ text: instruction })

    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction: SONGSELECT_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: songSelectResponseSchema,
        temperature: 0.1,
      },
    })
    const text = response.text
    if (!text) throw new Error('Empty response from Gemini vision model')

    let parsed: RawExtractionResponse
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Failed to parse structured JSON from Gemini: ${text.slice(0, 200)}`)
    }
    console.log('[extract-sheet] Gemini response payload:', JSON.stringify(parsed))
    if (!parsed.songs || !Array.isArray(parsed.songs)) {
      throw new Error('Gemini returned an invalid songs payload')
    }
    return parsed
  }

  const expected = options.expectedSongCount
  const visionChunks = makeVisionChunks(fallbackPages)
  const runBatches = async (isRetry: boolean): Promise<RawExtractionResponse> => {
    const results: Array<{ index: number; songs: RawExtractedSong[] }> = deterministic.map((page) => ({
      index: page.index,
      songs: [page.deterministicSong!],
    }))
    for (const chunk of visionChunks) {
      const batchStartPage = chunk.pages[0].index + 1
      const batchEndPage = chunk.pages.at(-1)!.index + 1
      options.onProgress?.({ type: 'batch', batchStartPage, batchEndPage })
      const result = await transcribe(
        chunk.pages,
        `${isRetry ? 'This is a completeness retry. ' : ''}These are ordered packet pages ${batchStartPage}-${batchEndPage}. Transcribe every section on these pages. If a chart continues from an earlier page, return it using its original title so it can be merged. Ignore blank pages and preserve chord alignment.`
      )
      results.push({ index: chunk.index, songs: result.songs })
    }
    options.onProgress?.({ type: 'merging' })
    const mergedSongs = mergeConsecutiveSongs(results.sort((a, b) => a.index - b.index).flatMap((result) => result.songs))
    if (mergedSongs.length === 0) {
      throw new Error('No songs could be identified in the uploaded document/images')
    }
    return { songs: mergedSongs }
  }
  const firstPass = await runBatches(false)

  if (expected === undefined || !needsSongCountRetry(expected, firstPass.songs.length)) {
    return transformRawSongsToAppSongs(firstPass.songs)
  }

  options.onProgress?.({
    type: 'retrying',
    expectedSongCount: expected,
    extractedSongCount: firstPass.songs.length,
  })
  const retry = await runBatches(true)
  if (retry.songs.length !== expected) {
    throw new ExpectedSongCountMismatchError(expected, retry.songs.length)
  }
  return transformRawSongsToAppSongs(retry.songs)
}
