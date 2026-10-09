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
                      chordLine: {
                        type: Type.STRING,
                        description:
                          'The line of chords, strictly preserving exact horizontal spaces/padding matching the sheet (e.g. "F#m7           E                                 D2").',
                      },
                      lyricLine: {
                        type: Type.STRING,
                        description:
                          'The line of lyrics, strictly preserving all leading spaces where chords play before lyrics begin (e.g. "       Heaven is trembling in awe of Your wonders") and intra-word spaces ("a - way").',
                      },
                      content: {
                        type: Type.STRING,
                        description:
                          'For chords-only / instrumental bars (e.g. "| A | A | Bm7 | Bm7 |") or fallback text.',
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
Your job is to transcribe the provided sheet document or images with 100% layout, whitespace, and musical timing fidelity.

CRITICAL RULES FOR SONGSELECT FORMAT:

1. TWO-COLUMN LAYOUT:
   - SongSelect chord charts are strictly formatted in two vertical columns per page.
   - You MUST read Column 1 completely from top-to-bottom first.
   - Then read Column 2 completely from top-to-bottom.
   - NEVER read horizontally across columns or interleave lines between Column 1 and Column 2!

2. PRESERVE WHITESPACE & MUSICAL TIMING (CRITICAL):
   - In SongSelect charts, horizontal whitespace represents musical timing:
     * LEADING SPACES IN LYRICS: When a chord is played on beat 1 before vocals enter (e.g. 'F#m7' plays on beat 1, and after a pause the vocals enter: 'Heaven is trembling...'), you MUST include the leading whitespace in 'lyricLine':
       Example:
       chordLine: "F#m7           E                                 D2"
       lyricLine: "       Heaven is trembling in awe of Your wonders"
     * INDENTED CHORDS: When chords occur later in a lyric line, pad 'chordLine' with spaces so each chord sits directly above the exact syllable it aligns with:
       Example:
       chordLine: "               A2                  E/G#"
       lyricLine: "Here in Your Presence we are un -      done"
     * MULTIPLE CHORDS: When multiple chords appear across a phrase (e.g. "Asus           A         Asus          A"), maintain their spaces so they never bunch up together.
     * SYLLABLES & HYPHENS: Preserve lyric spacing and hyphenation (e.g. "fade a - way", "dis - play", "ev'rything").

3. LINE PAIRING:
   - For every sung line, output a single item with:
     * 'kind': 'lyric'
     * 'chordLine': The chords and spaces above the lyric.
     * 'lyricLine': The lyrics and spaces below the chords.
   - If a lyric line has no chords above it, provide 'lyricLine' and leave 'chordLine' blank or null.

4. INSTRUMENTALS & CHORDS-ONLY:
   - For lines containing only chords, bar lines, or slash timing marks (e.g. Intro, Instrumental, Outro like '| A | A | Bm7 | Bm7 |'):
     * Set 'kind': 'chords-only'
     * Put the bar progression in 'content' or 'chordLine'.

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
 * Preserves the exact visual alignment above lyrics.
 */
export function extractChordsFromSpacedLine(chordLine: string): ChordPlacement[] {
  const chords: ChordPlacement[] = []
  const regex = /\S+/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(chordLine)) !== null) {
    const rawToken = match[0]
    // Strip trailing or leading punctuation/bars/parentheses (e.g. '|', '(', ')')
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
 * Parses bracketed notation like "[G]Amazing [C]grace" into the app's Line data model (fallback).
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

  while (i < content.length) {
    if (content[i] === '[') {
      const closeIdx = content.indexOf(']', i)
      if (closeIdx !== -1) {
        const chordCandidate = content.slice(i + 1, closeIdx).trim()
        if (chordCandidate) {
          chords.push({
            pos: cleanText.length,
            chord: chordCandidate,
          })
        }
        i = closeIdx + 1
        continue
      }
    }
    cleanText += content[i]
    i++
  }

  return {
    kind: 'lyric',
    text: cleanText,
    chords,
  }
}

/**
 * Converts a raw extracted line into the app's Line data model.
 * Prioritizes spaced chordLine + lyricLine to preserve timing and whitespace.
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

  // Spaced chordLine and lyricLine mode (preserves exact timing whitespace)
  if (line.chordLine !== undefined || line.lyricLine !== undefined) {
    const chordLine = line.chordLine || ''
    const lyricLine = line.lyricLine || ''

    if (!chordLine.trim()) {
      return { kind: 'lyric', text: lyricLine, chords: [] }
    }

    const chords = extractChordsFromSpacedLine(chordLine)

    // Ensure lyric text is padded if chords extend beyond the lyrics
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

  // Fallback to bracketed format if content provided
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
    text: 'Please transcribe all songs from the attached SongSelect sheets according to the system instructions, strictly preserving horizontal spacing and timing.',
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
