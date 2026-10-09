/**
 * Utilities for parsing and manipulating chord strings with the custom chord keyboard.
 */

export interface ParsedChordComponents {
  root: string
  accidental: string
  quality: string
  bass: string
  raw: string
}

const CHORD_REGEX = /^([A-G])([#b♯♭])?([^/]*)(?:\/([A-G][#b♯♭]?))?$/

export function parseChordComponents(chord: string): ParsedChordComponents | null {
  const trimmed = chord.trim()
  if (!trimmed) return null

  const match = CHORD_REGEX.exec(trimmed)
  if (!match) {
    return {
      root: '',
      accidental: '',
      quality: trimmed,
      bass: '',
      raw: trimmed,
    }
  }

  return {
    root: match[1] || '',
    accidental: match[2] || '',
    quality: match[3] || '',
    bass: match[4] || '',
    raw: trimmed,
  }
}

/** Sets or replaces the root note while preserving quality and slash bass. */
export function applyRoot(current: string, newRoot: string): string {
  const trimmed = current.trim()
  if (!trimmed) return newRoot

  // If input currently ends with a slash (e.g. "G/"), set the slash bass note
  if (trimmed.endsWith('/')) {
    return `${trimmed}${newRoot}`
  }

  const parsed = parseChordComponents(trimmed)
  if (!parsed || !parsed.root) {
    return newRoot
  }

  const fullRoot = `${newRoot}${parsed.accidental}`
  const bassPart = parsed.bass ? `/${parsed.bass}` : ''
  return `${fullRoot}${parsed.quality}${bassPart}`
}

/** Toggles or swaps accidental on the root note (or on the slash bass if input ends with bass). */
export function applyAccidental(current: string, accidental: '#' | 'b'): string {
  const trimmed = current.trim()
  if (!trimmed) return ''

  // If chord ends with a slash (e.g. "G/"), don't apply accidental to nothing
  if (trimmed.endsWith('/')) return trimmed

  const parsed = parseChordComponents(trimmed)
  if (!parsed) return trimmed

  // Check if we should apply to bass note
  if (parsed.bass) {
    const bassRoot = parsed.bass[0]
    const currentBassAcc = parsed.bass.slice(1)
    let newBassAcc: '#' | 'b' | '' = accidental
    if (currentBassAcc === accidental) {
      newBassAcc = '' // toggle off
    }
    const newBass = `${bassRoot}${newBassAcc}`
    const mainPart = `${parsed.root}${parsed.accidental}${parsed.quality}`
    return `${mainPart}/${newBass}`
  }

  // Otherwise apply to main root note
  if (!parsed.root) return trimmed

  let newAcc: '#' | 'b' | '' = accidental
  if (parsed.accidental === accidental) {
    newAcc = '' // toggle off
  }

  return `${parsed.root}${newAcc}${parsed.quality}`
}

/** Sets or replaces the quality (suffix) on the chord. 'maj' clears the quality to plain major. */
export function applyQuality(current: string, quality: string): string {
  const trimmed = current.trim()
  const qToApply = quality === 'maj' ? '' : quality

  if (!trimmed) return qToApply

  const parsed = parseChordComponents(trimmed)
  if (!parsed || !parsed.root) {
    return `${trimmed}${qToApply}`
  }

  const mainRoot = `${parsed.root}${parsed.accidental}`
  const bassPart = parsed.bass ? `/${parsed.bass}` : ''
  return `${mainRoot}${qToApply}${bassPart}`
}

/** Handles slash key: toggles slash on chord. */
export function applySlash(current: string): string {
  const trimmed = current.trim()
  if (!trimmed) return '/'

  if (trimmed.endsWith('/')) {
    return trimmed.slice(0, -1)
  }

  // If chord already has slash bass, remove the bass and slash
  const slashIdx = trimmed.indexOf('/')
  if (slashIdx >= 0) {
    return trimmed.slice(0, slashIdx) + '/'
  }

  return `${trimmed}/`
}
