import { parseKey } from './transpose'

const MAJOR_KEYS = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
]

const MINOR_KEYS = [
  'Cm',
  'C#m',
  'Dbm',
  'Dm',
  'D#m',
  'Ebm',
  'Em',
  'Fm',
  'F#m',
  'Gbm',
  'Gm',
  'G#m',
  'Abm',
  'Am',
  'A#m',
  'Bbm',
  'Bm',
]

/** The selectable keys (including both sharp and flat enharmonic spellings), major or minor to match the original key's mode. */
export function keyOptions(minor: boolean): string[] {
  return minor ? MINOR_KEYS : MAJOR_KEYS
}

/**
 * Shortest signed semitone distance from one key to another, in the range -5…+6
 * (e.g. G → E is -3, not +9).
 */
export function keyOffset(from: string, to: string): number {
  const a = parseKey(from)
  const b = parseKey(to)
  if (!a || !b) return 0
  const diff = (((b.root - a.root) % 12) + 12) % 12
  return diff > 6 ? diff - 12 : diff
}

/** Formats an offset for display: "+2", "−3" or "0". */
export function formatOffset(offset: number): string {
  if (offset === 0) return '0'
  return offset > 0 ? `+${offset}` : `−${Math.abs(offset)}`
}

/**
 * Picks the option in `keyOptions` that matches `key`.
 * Prefers an exact enharmonic spelling match (e.g. "C#" → "C#", "Db" → "Db"),
 * and falls back to pitch-class match for theoretical spellings (e.g. "Cb" → "B").
 */
export function matchKeyOption(key: string): string | null {
  const parsed = parseKey(key)
  if (!parsed) return null
  const normalizedRoot = parsed.rootName.replace('♯', '#').replace('♭', 'b')
  const options = keyOptions(parsed.minor)
  const exactMatch = options.find((o) => parseKey(o)?.rootName === normalizedRoot)
  if (exactMatch) return exactMatch
  return options.find((o) => parseKey(o)?.root === parsed.root) ?? null
}
