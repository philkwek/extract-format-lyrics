import { GoogleGenAI, Type } from '@google/genai'
import type { Song, Section, SectionType, Line, ChordPlacement } from './types.js'
import { isChord } from './chords.js'

export interface RawExtractedLine {
  kind: 'lyric' | 'chords-only'
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
                      content: {
                        type: Type.STRING,
                        description:
                          'For lyric lines: lyric text with chords in square brackets embedded directly before the syllable they sit above, e.g. "[Asus]Found in Your [A]hands [Asus]fullness of [A]joy". When a chord plays on a beat before lyrics begin, strictly preserve leading whitespace: "[F#m7]       Heaven is [E]trembling". For chords-only: bar line, e.g. "| A | A | Bm7 | Bm7 |".',
                      },
                      chordLine: {
                        type: Type.STRING,
                        description: 'Optional raw chord line.',
                      },
                      lyricLine: {
                        type: Type.STRING,
                        description: 'Optional raw lyric line preserving leading spaces.',
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

2. CHORD-TO-SYLLABLE ALIGNMENT (CRITICAL):
   - In SongSelect, chords are printed directly above specific words and syllables.
   - Embed each chord in square brackets immediately preceding the exact word or syllable it aligns with:
     * "[Asus]Found in Your [A]hands [Asus]fullness of [A]joy" (Asus is above Found, A is above hands, Asus is above fullness, A is above joy)
     * "[Bm7]Every fear suddenly wiped [A/C#]a - [D]way" (Bm7 is above Every, A/C# is above a -, D is above way)
     * "Here in Your [A]Presence" ('Here in Your' has no chord; A is above Presence)
     * "Here in Your Presence we are [A2]un -      [E/G#]done" (A2 is above un -, E/G# is above done)
     * "Here in Your Presence [F#m7]heaven and [E]earth become   [D]one"
     * "[Asus]All   of my gains now [A]fade [Asus]a - [A]way"

3. INSTRUMENTAL TIMING & LEADING WHITESPACE (CRITICAL):
   - When a chord plays on beat 1 BEFORE lyrics enter (e.g. In Pre-Chorus: F#m7 plays on beat 1, then an instrumental rest, then 'Heaven is trembling...'):
     You MUST put the chord at the beginning followed by the leading whitespace to mark the timing rest:
     Example:
     content: "[F#m7]       Heaven is [E]trembling in awe of Your [D2]wonders"
     content: "[F#m7]       The kings and their [E]kingdoms are standing [D2]a - mazed"

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
