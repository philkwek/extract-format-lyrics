import { parseKey } from './transpose'

const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

/** The 12 selectable keys, major or minor to match the original key's mode. */
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

/** Picks the option in `keyOptions` that matches `key` by pitch (handles enharmonics like A# → Bb). */
export function matchKeyOption(key: string): string | null {
  const parsed = parseKey(key)
  if (!parsed) return null
  const options = keyOptions(parsed.minor)
  return options.find((o) => parseKey(o)?.root === parsed.root) ?? null
}
