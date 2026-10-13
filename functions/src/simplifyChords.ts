import { parseChord } from './chords.js'
import type { Section, Line, ChordPlacement } from './types.js'

export type SimplifiedChordQuality = 'major' | 'minor'

/**
 * Classifies a chord quality string into 'major', 'minor', or null if unrecognized/unsupported.
 *
 * Rules:
 * - Plain major, dominant, augmented, suspended, and power chords become major.
 * - Minor, diminished, and half-diminished chords become minor.
 * - An explicitly minor chord remains minor even when it contains other modifiers.
 * - Suffixes starting with "maj" or "M" are major, NOT minor.
 */
export function classifyChordQuality(quality: string): SimplifiedChordQuality | null {
  if (quality === '') {
    return 'major'
  }

  // Diminished & half-diminished (e.g. dim, dim7, °, ø)
  if (/^(?:dim|°|ø)/i.test(quality)) {
    return 'minor'
  }

  // Explicit major prefixes (maj, M) must be checked before 'm'
  if (/^maj/i.test(quality) || /^M(?![a-z])/.test(quality)) {
    return 'major'
  }

  // Explicit minor: "min", or "m" not followed by "aj" (e.g. m, m7, m9, m11, m13, m6, madd9, m7b5, mMaj7)
  if (/^min/i.test(quality) || /^m(?!aj)/i.test(quality)) {
    return 'minor'
  }

  // Jazz notation for minor: "-" followed by digit, modifier, or standalone "-"
  if (/^-(?:\d|[a-z]|$)/i.test(quality)) {
    return 'minor'
  }

  // Augmented (aug, +)
  if (/^(?:aug|\+)/i.test(quality)) {
    return 'major'
  }

  // Suspended (sus, sus2, sus4, sus9)
  if (/^sus/i.test(quality)) {
    return 'major'
  }

  // Added notes (add, add9, add2, add4)
  if (/^add/i.test(quality)) {
    return 'major'
  }

  // Power chords (5)
  if (/^5(?:[^\d]|$)/.test(quality)) {
    return 'major'
  }

  // Dominant / number-based qualities (7, 9, 11, 13, 6, 6/9, 2, 4, etc.)
  if (/^\d/.test(quality)) {
    return 'major'
  }

  // Parenthesized modifiers or alterations like (add9), (b9), (#11), no3, no5
  if (/^(?:\([^)]*\)|no\d)/i.test(quality)) {
    return 'major'
  }

  return null
}

/**
 * Simplifies an individual chord symbol to its plain major or minor triad,
 * stripping extensions, additions, suspensions, altered fifths, and slash bass notes.
 *
 * Preserves root spelling (including sharps and flats).
 * Non-chords (e.g. "N.C.", unrecognized tokens) remain unchanged.
 */
export function simplifyChord(token: string): { simplified: string; changed: boolean } {
  const parsed = parseChord(token)
  if (!parsed) {
    return { simplified: token, changed: false }
  }

  const quality = classifyChordQuality(parsed.quality)
  if (!quality) {
    return { simplified: token, changed: false }
  }

  const simplified = quality === 'minor' ? `${parsed.rootName}m` : parsed.rootName
  return {
    simplified,
    changed: simplified !== token,
  }
}

/**
 * Creates a brand new section tree with chords simplified according to the fallback rules.
 * Never mutates the original sections.
 *
 * Preserves:
 * - Section types and labels
 * - Line order and types
 * - Lyric text, chord positions, and splitFromPrevious flags
 * - Tab lines unchanged
 */
export function simplifySections(sections: Section[]): { sections: Section[]; changedCount: number } {
  let changedCount = 0

  const newSections: Section[] = sections.map((section) => {
    const newLines: Line[] = section.lines.map((line) => {
      if (line.kind === 'lyric') {
        const newChords: ChordPlacement[] = line.chords.map((cp) => {
          const { simplified, changed } = simplifyChord(cp.chord)
          if (changed) {
            changedCount++
          }
          return { pos: cp.pos, chord: simplified }
        })

        const newLine: Line = {
          kind: 'lyric',
          text: line.text,
          chords: newChords,
        }
        if (line.splitFromPrevious !== undefined) {
          newLine.splitFromPrevious = line.splitFromPrevious
        }
        return newLine
      }

      if (line.kind === 'chords-only') {
        const newChords = line.chords.map((ch) => {
          const { simplified, changed } = simplifyChord(ch)
          if (changed) {
            changedCount++
          }
          return simplified
        })
        return {
          kind: 'chords-only',
          chords: newChords,
        }
      }

      // Tab lines: preserve unchanged
      return {
        kind: 'tab',
        raw: line.raw,
      }
    })

    return {
      type: section.type,
      label: section.label,
      lines: newLines,
    }
  })

  return {
    sections: newSections,
    changedCount,
  }
}
