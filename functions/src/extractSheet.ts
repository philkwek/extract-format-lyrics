import { GoogleGenAI, Type } from '@google/genai'
import type { Song, Section, SectionType, Line, ChordPlacement } from './types.js'
import { isChord } from './chords.js'

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

1. TWO-COLUMN LAYOUT:
   - SongSelect chord charts are strictly formatted in two vertical columns per page.
   - You MUST read Column 1 completely from top-to-bottom first.
   - Then read Column 2 completely from top-to-bottom.
   - NEVER read horizontally across columns or interleave lines between Column 1 and Column 2!

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
 * Builds a lyric Line from geometry reported by the vision model.
 * Each word and chord carries horizontal bounds (0-1000, fraction of page width).
 * A chord is attached to the last word that starts at/left of the chord's centre.
 * Chords left of the first word are timing rests: they sit at pos 0 and the
 * lyric is indented proportionally so the rest is preserved.
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

  // Character offset of each word in the joined text (single space separated)
  const starts: number[] = []
  let cursor = 0
  for (const w of ws) {
    starts.push(cursor)
    cursor += w.text.length + 1
  }

  const firstX = ws[0].x0
  const rests: string[] = []
  const placed: ChordPlacement[] = []
  for (const c of cs) {
    const centre = (c.x0 + c.x1) / 2
    if (centre < firstX - charWidth * 0.5 && c.x1 <= firstX + charWidth * 0.5) {
      rests.push(c.chord)
      continue
    }
    let idx = 0
    for (let i = 0; i < ws.length; i++) if (ws[i].x0 <= centre) idx = i
    if (centre > ws[idx].x1 && idx + 1 < ws.length) idx += 1
    placed.push({ pos: starts[idx], chord: c.chord })
  }

  let text = ws.map((w) => w.text).join(' ')
  const chords: ChordPlacement[] = []

  if (rests.length > 0) {
    const restLeft = cs.find((c) => rests.includes(c.chord))?.x0 ?? firstX
    const restChars = rests.reduce((n, r) => n + r.length + 1, 0)
    const indent = Math.max(restChars, Math.round((firstX - restLeft) / charWidth))
    let pos = 0
    for (const r of rests) {
      chords.push({ pos, chord: r })
      pos += r.length + 1
    }
    text = ' '.repeat(indent) + text
    for (const p of placed) chords.push({ ...p, pos: p.pos + indent })
  } else {
    chords.push(...placed)
  }

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

/**
 * Transforms the raw Gemini extraction result into full Song objects compatible with the application.
 */
export function transformRawSongsToAppSongs(rawSongs: RawExtractedSong[], sourceLabel = 'SongSelect Upload'): Song[] {
  return rawSongs.map((raw, idx) => {
    const songId = `upload-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`

    const sections: Section[] = (raw.sections || []).map((s) => ({
      type: s.type || 'Other',
      label: s.label || s.type || 'Section',
      lines: (s.lines || []).map((l) => rawLineToModelLine(l)),
    }))

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

/**
 * Extracts SongSelect songs from uploaded PDF or image files using Gemini Flash-Lite.
 */
export async function extractSongsWithGemini(
  files: SheetFilePart[],
  apiKey?: string,
  modelName: string = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
): Promise<Song[]> {
  const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY
  if (!resolvedApiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please supply an API key or configure it in Cloud Functions.')
  }

  const ai = new GoogleGenAI({ apiKey: resolvedApiKey })

  const contentsParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = files.map(
    (file) => ({
      inlineData: {
        mimeType: file.mimeType,
        data: file.base64Data,
      },
    })
  )

  contentsParts.push({
    text: 'Please transcribe all songs from the attached SongSelect sheets according to the system instructions, strictly preserving syllable alignment and leading whitespace timing.',
  })

  const response = await ai.models.generateContent({
    model: modelName,
    contents: contentsParts,
    config: {
      systemInstruction: SONGSELECT_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: songSelectResponseSchema,
      temperature: 0.1,
    },
  })

  const text = response.text
  if (!text) {
    throw new Error('Empty response from Gemini vision model')
  }

  let parsed: RawExtractionResponse
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Failed to parse structured JSON from Gemini: ${text.slice(0, 200)}`)
  }

  if (!parsed.songs || !Array.isArray(parsed.songs) || parsed.songs.length === 0) {
    throw new Error('No songs could be identified in the uploaded document/images')
  }

  return transformRawSongsToAppSongs(parsed.songs)
}
