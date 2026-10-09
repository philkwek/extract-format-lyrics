import { noteToIndex, parseChord } from './chords'
import type { Line, Song } from '../types/song'

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Pitch-class index of the major keys that are conventionally spelled with flats (F, Bb, Eb, Ab, Db). */
const FLAT_MAJOR_ROOTS = new Set([5, 10, 3, 8, 1])

export interface ParsedKey {
  root: number
  minor: boolean
  rootName: string
}

/** Parses a key such as "G", "F#", "Bbm", "Am". */
export function parseKey(key: string): ParsedKey | null {
  const m = /^([A-G][#b♯♭]?)(m|min|minor)?$/.exec(key.trim())
  if (!m) return null
  const root = noteToIndex(m[1])
  if (root === null) return null
  return { root, minor: Boolean(m[2]), rootName: m[1] }
}

/** Whether chords in this key should be spelled with flats. */
export function keyUsesFlats(key: string): boolean {
  const parsed = parseKey(key)
  if (!parsed) return false
  if (parsed.rootName.includes('b') || parsed.rootName.includes('♭')) return true
  if (parsed.rootName.includes('#') || parsed.rootName.includes('♯')) return false
  const relativeMajor = parsed.minor ? (parsed.root + 3) % 12 : parsed.root
  return FLAT_MAJOR_ROOTS.has(relativeMajor)
}

function noteName(index: number, useFlats: boolean): string {
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[((index % 12) + 12) % 12]
}

/** Transposes one chord symbol. Non-chord text is returned unchanged. */
export function transposeChord(chord: string, semitones: number, useFlats: boolean): string {
  const parsed = parseChord(chord)
  if (!parsed) return chord
  const root = noteName(parsed.root + semitones, useFlats)
  const bass = parsed.bass === null ? '' : `/${noteName(parsed.bass + semitones, useFlats)}`
  return `${root}${parsed.quality}${bass}`
}

function transposeLine(line: Line, semitones: number, useFlats: boolean): Line {
  switch (line.kind) {
    case 'lyric':
      return {
        ...line,
        chords: line.chords.map((c) => ({
          ...c,
          chord: transposeChord(c.chord, semitones, useFlats),
        })),
      }
    case 'chords-only':
      return { ...line, chords: line.chords.map((c) => transposeChord(c, semitones, useFlats)) }
    default:
      return line
  }
}

/** Returns a new song with every chord shifted by `semitones`, spelled for `targetKey`. */
export function transposeSong(song: Song, semitones: number, targetKey: string): Song {
  if (semitones % 12 === 0) return song
  const useFlats = keyUsesFlats(targetKey)
  return {
    ...song,
    sections: song.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => transposeLine(l, semitones, useFlats)),
    })),
  }
}
