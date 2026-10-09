/** Chord parsing. Pure and dependency-free so it can be shared by backend and frontend. */

export interface ParsedChord {
  /** Root pitch class 0-11 (C=0). */
  root: number
  /** Original root spelling, e.g. "F#". */
  rootName: string
  /** Everything between the root and an optional bass note, e.g. "m7b5". */
  quality: string
  /** Bass note pitch class for slash chords, or null. */
  bass: number | null
  bassName: string | null
}

const LETTER_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Returns the pitch class for a note name like "F#" or "Bb", or null if invalid. */
export function noteToIndex(note: string): number | null {
  const m = /^([A-G])([#b♯♭]?)$/.exec(note)
  if (!m) return null
  const base = LETTER_INDEX[m[1]]
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0
  return (base + acc + 12) % 12
}

// Quality: sequence of known chord-modifier tokens (e.g. m, maj7, sus4, add9, b5, #9, 13, (b9), dim, aug, +, °, ø, -).
const QUALITY = /^(?:maj|min|dim|aug|sus|add|no|m|M|[+\-°ø]|\d+|[#b]\d+|\([^)]*\))*$/

const CHORD = /^([A-G][#b♯♭]?)([^/\s]*)(?:\/([A-G][#b♯♭]?))?$/

/** Parses a chord symbol such as "F#m7b5/C". Returns null if the token is not a chord. */
export function parseChord(token: string): ParsedChord | null {
  const m = CHORD.exec(token)
  if (!m) return null
  const [, rootName, quality, bassName] = m
  if (!QUALITY.test(quality)) return null
  const root = noteToIndex(rootName)
  if (root === null) return null
  let bass: number | null = null
  if (bassName) {
    bass = noteToIndex(bassName)
    if (bass === null) return null
  }
  return { root, rootName, quality, bass, bassName: bassName ?? null }
}

export function isChord(token: string): boolean {
  return parseChord(token) !== null
}

/** True if the line consists solely of chord tokens (ignoring bars / separators). */
export function isChordLine(line: string): boolean {
  const tokens = line
    .split(/\s+/)
    .filter((t) => t && !/^[|:\-.x\d]+$/i.test(t) && !/^\(?x\d+\)?$/i.test(t))
  if (tokens.length === 0) return false
  const chordCount = tokens.filter(isChord).length
  return chordCount / tokens.length >= 0.6
}
