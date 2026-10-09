import { GoogleGenAI, Type } from '@google/genai'
import type { Song, Section, SectionType, Line, ChordPlacement } from './types.js'
import { isChord } from './chords.js'

export interface RawExtractedLine {
  kind: 'lyric' | 'chords-only'
  content: string
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
                      content: { type: Type.STRING },
                    },
                    required: ['kind', 'content'],
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
Your job is to transcribe the provided sheet document or images with 100% layout and musical fidelity.

CRITICAL RULES FOR SONGSELECT FORMAT:
1. TWO-COLUMN LAYOUT: SongSelect chord charts are strictly formatted in two vertical columns per page.
   - You MUST read Column 1 completely from top-to-bottom first.
   - Then read Column 2 completely from top-to-bottom.
   - NEVER read horizontally across columns or interleave lines between Column 1 and Column 2!
2. MULTI-PAGE SONGS:
   - If a song spans multiple pages (e.g. Page 2 has '[Song Title] - 2' or 'Page 2 of 2' and does not have a new author/key header), combine its sections in reading order into that single song.
3. MULTI-SONG PACKETS:
   - If a new song begins (new Title, new 'Words and Music by...', new Key, or new CCLI Song #), output it as a new distinct entry in the 'songs' array.
4. BRACKETED CHORD NOTATION:
   - For lyric lines with chords printed above, embed each chord in square brackets immediately preceding the syllable it belongs to.
     Example: "[G]Amazing [C/E]grace how [G]sweet the sound"
   - Do NOT place chords on their own line if they sit above lyrics.
5. CHORDS-ONLY / INSTRUMENTALS:
   - For lines that contain only chord progressions, bar lines, or timing slashes (like Intros, Interludes, Instrumentals, Outros), mark kind: 'chords-only' and put the chord tokens in content (e.g. '| G / / / | C / / / |' or 'G C Em D').
6. METADATA EXTRACTION:
   - Extract 'title' accurately.
   - Extract 'artist' from 'Words and Music by...'.
   - Extract 'originalKey' (e.g. 'G', 'D', 'Bb', 'Am', etc.).
   - Extract 'tempo' (e.g. '72 bpm') and 'ccliNumber' if present.
7. STRIP NOISE:
   - Omit copyright notices, license disclaimers, page numbering, and CCLI website footers.
`.trim()

/**
 * Parses bracketed notation like "[G]Amazing [C]grace" into the app's Line data model.
 */
export function bracketedLineToModelLine(kind: 'lyric' | 'chords-only', content: string): Line {
  if (kind === 'chords-only') {
    // Extract chord tokens
    const tokens = content.match(/[A-G][b#]?(?:maj|min|m|M|sus|aug|dim|add|[0-9])*(?:\/[A-G][b#]?)?/g) || []
    const validChords = tokens.filter((t) => isChord(t))
    if (validChords.length > 0) {
      return { kind: 'chords-only', chords: validChords }
    }
    // Fallback if no valid chord recognized
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
 * Transforms the raw Gemini extraction result into full Song objects compatible with the application.
 */
export function transformRawSongsToAppSongs(rawSongs: RawExtractedSong[], sourceLabel = 'SongSelect Upload'): Song[] {
  return rawSongs.map((raw, idx) => {
    const songId = `upload-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`

    const sections: Section[] = (raw.sections || []).map((s) => ({
      type: s.type || 'Other',
      label: s.label || s.type || 'Section',
      lines: (s.lines || []).map((l) => bracketedLineToModelLine(l.kind, l.content)),
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
 * Extracts SongSelect songs from uploaded PDF or image files using Gemini 2.0 Flash.
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
    text: 'Please transcribe all songs from the attached SongSelect sheets according to the system instructions.',
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
