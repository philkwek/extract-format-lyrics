import { noteToIndex, parseChord } from './chords.js'
import { classifyChordQuality } from './simplifyChords.js'
import { normalizeSongText, detectSectionHeader } from './normalizer.js'
import type { Section } from './types.js'

export const SONG_KEY_PRESETS = [
  'Ab', 'A', 'A#', 'Bb', 'B', 'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#',
] as const
export type SongKeyPreset = typeof SONG_KEY_PRESETS[number]

export interface KeyDetectionResult {
  /** Output major-key family, including when internal analysis favors minor. */
  key: SongKeyPreset
  /** Formatted output major-key family, e.g. "E Major". */
  formattedKey: `${SongKeyPreset} Major`
  /** Concise relative minor symbol, e.g. "C#m" */
  relativeMinor: string
  /** Formatted relative minor name, e.g. "C# minor" */
  formattedRelativeMinor: string
  /** Heuristic confidence, not a calibrated probability (0.0 to 1.0). */
  confidence: number
  /** Strict major/natural-minor triad fit; borrowed/altered chords are excluded. */
  diatonicFitRatio: number
  /** Distinct chords detected in the song */
  chordsDetected: string[]

  // Snake_case aliases for prompt specification compatibility
  relative_minor: string
  diatonic_fit_ratio: number
  chords_detected: string[]
}

const SHARP_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Major keys conventionally spelled with flats (F=5, Bb=10, Eb=3, Ab=8, Db=1). */
const FLAT_MAJOR_ROOTS = new Set([5, 10, 3, 8, 1])

/**
 * Returns preferred note name for a pitch class (0-11).
 */
function pitchClassToNoteName(pitchClass: number, preferFlats: boolean): string {
  const pc = ((pitchClass % 12) + 12) % 12
  return preferFlats ? FLAT_NOTE_NAMES[pc] : SHARP_NOTE_NAMES[pc]
}

/** Constrains output labels, not tonal inference. Invalid/missing keys stay null. */
export function normalizeSongKey(key: string | null | undefined, preferFlats?: boolean): SongKeyPreset | null {
  const match = /^([A-G][#b♯♭]?)(m|\s*[Mm]inor|\s*[Mm]ajor)?$/.exec(key?.trim() ?? '')
  if (!match) return null
  const rootName = match[1].replace('♯', '#').replace('♭', 'b')
  const tonic = noteToIndex(rootName)
  if (tonic === null) return null
  const minor = match[2] === 'm' || match[2]?.trim().toLowerCase() === 'minor'
  const majorTonic = minor ? (tonic + 3) % 12 : tonic
  // Keep valid major spellings; otherwise use the detector's signature convention.
  const spelling = !minor && SONG_KEY_PRESETS.some(preset => preset === rootName)
    ? rootName
    : pitchClassToNoteName(majorTonic, preferFlats ??
      (majorTonic === 6 ? rootName.includes('b') : FLAT_MAJOR_ROOTS.has(majorTonic)))
  return SONG_KEY_PRESETS.find(preset => preset === spelling) ?? null
}

type DetectionQuality = 'major' | 'minor' | 'diminished' | 'augmented' | 'thirdless'
interface Harmony {
  root: number
  quality: DetectionQuality
  dominantSeventh: boolean
}
interface DetectedChordOccurrence extends Harmony {
  rawChord: string
  rootName: string
  sectionIndex: number
  sectionWeight: number
}

// Keep detection vocabulary separate from the user-facing chord simplifier.
function detectionQuality(quality: string): DetectionQuality | null {
  if (/^(?:dim|°|ø)/i.test(quality) || /^(?:m(?!aj)|min|-).*?(?:b5|♭5)/i.test(quality)) return 'diminished'
  if (/^(?:aug|\+)/i.test(quality)) return 'augmented'
  if (/sus|no3/i.test(quality) || quality === '5') return 'thirdless'
  return classifyChordQuality(quality)
}

function extractChordOccurrences(sections: Section[]): DetectedChordOccurrence[] {
  const occurrences: DetectedChordOccurrence[] = []
  sections.forEach((section, sectionIndex) => {
    const sectionChords: DetectedChordOccurrence[] = []
    for (const line of section.lines) {
      const tokens = line.kind === 'lyric' ? line.chords.map(cp => cp.chord)
        : line.kind === 'chords-only' ? line.chords : []
      for (const token of tokens) {
        const parsed = parseChord(token)
        if (!parsed) continue
        const quality = detectionQuality(parsed.quality)
        if (!quality) continue
        sectionChords.push({
          rawChord: token, rootName: parsed.rootName, root: parsed.root, quality,
          dominantSeventh: quality === 'major' && /^(?:7|9|11|13)(?!\d)/.test(parsed.quality),
          sectionIndex,
          // Pre-choruses are not chorus anchors. Intros/interludes provide
          // less mode evidence than sung sections, especially in Axis loops.
          sectionWeight: /^chorus(?:\b|$)/i.test(section.type.trim()) ? 2
            : /^(?:intro|instrumental)$/i.test(section.type.trim()) ? 0.5 : 1,
        })
      }
    }
    if (sectionChords.length) {
      occurrences.push(...sectionChords)
    }
  })
  return occurrences
}

const MAJOR_DEGREES: Array<[number, DetectionQuality]> = [
  [0, 'major'], [2, 'minor'], [4, 'minor'], [5, 'major'],
  [7, 'major'], [9, 'minor'], [11, 'diminished'],
]
const MINOR_DEGREES: Array<[number, DetectionQuality]> = [
  [0, 'minor'], [2, 'diminished'], [3, 'major'], [5, 'minor'],
  [7, 'minor'], [8, 'major'], [10, 'major'],
]
const offsetFrom = (root: number, tonic: number) => (root - tonic + 12) % 12

function strictFit(h: Harmony, tonic: number, minor: boolean): boolean {
  const offset = offsetFrom(h.root, tonic)
  // Diatonic triad fit, with the dominant seventh's lowered seventh checked too.
  return (minor ? MINOR_DEGREES : MAJOR_DEGREES).some(([degree, quality]) =>
    degree === offset && quality === h.quality && (!h.dominantSeventh || degree === (minor ? 10 : 7)))
}

function harmonicSupport(h: Harmony, tonic: number, minor: boolean): number {
  if (strictFit(h, tonic, minor)) return 1
  const offset = offsetFrom(h.root, tonic)
  if (h.quality === 'thirdless') {
    return (minor ? MINOR_DEGREES : MAJOR_DEGREES).some(([degree]) => degree === offset) ? 0.5 : 0
  }
  // Altered/borrowed support is deliberately distinct from strict diatonic fit.
  if (minor && ((offset === 7 && h.quality === 'major') || (offset === 11 && h.quality === 'diminished'))) return 0.9
  if (minor && offset === 5 && h.quality === 'major') return 0.5 // Dorian IV
  if (!minor && ((offset === 10 && h.quality === 'major') || (offset === 5 && h.quality === 'minor'))) return 0.5
  // A secondary dominant is plausible context, never proof of a minor tonic.
  if (!minor && [2, 4, 9].includes(offset) && h.quality === 'major') return 0.2
  return 0
}

interface KeyCandidate {
  tonic: number
  minor: boolean
  score: number
  fitRatio: number
  support: number
  strongResolution: boolean
}

function scoreCandidate(occurrences: DetectedChordOccurrence[], unique: Harmony[], tonic: number, minor: boolean): KeyCandidate {
  const isTonic = (h: Harmony) => h.root === tonic && h.quality === (minor ? 'minor' : 'major')
  const fitRatio = unique.filter(h => strictFit(h, tonic, minor)).length / unique.length
  const support = unique.reduce((sum, h) => sum + harmonicSupport(h, tonic, minor), 0) / unique.length
  let sectionEvidence = 0
  let sectionWeight = 0
  let strongResolution = false
  const groups = new Map<number, DetectedChordOccurrence[]>()
  for (const occ of occurrences) {
    const group = groups.get(occ.sectionIndex) ?? []
    group.push(occ)
    groups.set(occ.sectionIndex, group)
  }
  for (const annotatedGroup of groups.values()) {
    // Repeating the same chord above successive lyric lines is not a new
    // harmonic event. Without duration data, don't let annotation density
    // dilute resolutions or inflate tonic frequency.
    const group = annotatedGroup.filter((chord, index) => {
      const previous = annotatedGroup[index - 1]
      return !previous || chord.root !== previous.root || chord.quality !== previous.quality
        || chord.dominantSeventh !== previous.dominantSeventh
    })
    const weight = group[0].sectionWeight
    const tonicCount = group.filter(isTonic).length
    let cadenceTotal = 0
    // Only observed transitions within a section; no invented wraparound cadence.
    for (let i = 1; i < group.length; i++) {
      const previous = group[i - 1]
      if (!isTonic(group[i])) continue
      const offset = offsetFrom(previous.root, tonic)
      if (offset === 7 && previous.quality === 'major') {
        const strong = previous.dominantSeventh || unique.length >= 3
        cadenceTotal += previous.dominantSeventh ? 1.2 : strong ? 1 : 0.1
        strongResolution ||= strong
      } else if (offset === 11 && previous.quality === 'diminished') {
        cadenceTotal += 1
        strongResolution = true
      } else if (offset === 7 && previous.quality === 'minor' && minor) {
        cadenceTotal += 0.5
      } else if (offset === 5 && previous.quality === (minor ? 'minor' : 'major')) {
        // Plagal arrivals support a tonal center even without a leading tone.
        // Keep them below authentic resolutions, but on par with minor v-i.
        cadenceTotal += unique.length < 3 ? 0 : 0.5
      } else if (offset === 10 && previous.quality === 'major') {
        // Equally weak contextual evidence: bVII-i or Mixolydian bVII-I.
        cadenceTotal += 0.25
      }
    }
    const evidence = 0.6 * tonicCount / group.length
      + (isTonic(group[0]) ? 0.65 : 0)
      + (isTonic(group[group.length - 1]) ? (unique.length < 3 ? 0.3 : 0.65) : 0)
      + Math.min(1.2, cadenceTotal / Math.max(1, group.length - 1) * 3)
    sectionEvidence += weight * evidence
    sectionWeight += weight
  }
  // Harmonic compatibility must outweigh several coincident section anchors:
  // starting/ending on IV does not make it I when another key fits every chord.
  const score = 8 * support + sectionEvidence / sectionWeight
    + (unique.some(isTonic) ? 0.25 : 0)
    + (isTonic(occurrences[0]) ? (unique.length < 3 ? 0.2 : 0.1) : 0)
    + (isTonic(occurrences[occurrences.length - 1]) ? (unique.length < 3 ? 0.1 : 0.35) : 0)
  return { tonic, minor, score, fitRatio, support, strongResolution }
}

/** Jointly ranks 24 tonal centers, then labels the winning major-key family.
 * Modal chords receive partial compatibility; output groups relative modes. */
export function detectSongKeyFromSections(sections: Section[]): KeyDetectionResult | null {
  const occurrences = extractChordOccurrences(sections)
  if (!occurrences.length) return null
  const distinctChords = [...new Set(occurrences.map(o => o.rawChord))]
  const unique = [...new Map(occurrences.map(o => [`${o.root}:${o.quality}:${o.dominantSeventh}`, o])).values()]
  const candidates: KeyCandidate[] = []
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) candidates.push(scoreCandidate(occurrences, unique, tonic, minor))
  }
  // Explicit tie break: prefer major, then pitch class; tie confidence stays low.
  candidates.sort((a, b) => b.score - a.score || Number(a.minor) - Number(b.minor) || a.tonic - b.tonic)
  const best = candidates[0]
  const parentTonic = best.minor ? (best.tonic + 3) % 12 : best.tonic
  const minorTonic = (parentTonic + 9) % 12
  const margin = Math.max(0, best.score - candidates[1].score)
  let confidence = 0.45 * best.support + 0.35 * Math.min(1, margin) + (best.strongResolution ? 0.2 : 0.05)
  const relative = candidates.find(c => c.minor !== best.minor && c.tonic === (best.minor ? parentTonic : minorTonic))!
  // A shared Axis collection cannot establish mode without melody/rhythm.
  const hasRelativeTonic = unique.some(h => h.root === relative.tonic && h.quality === (relative.minor ? 'minor' : 'major'))
  if (hasRelativeTonic && !best.strongResolution && Math.abs(best.support - relative.support) < 0.1) confidence = Math.min(confidence, 0.6)
  if (!unique.some(h => h.root === best.tonic && h.quality === (best.minor ? 'minor' : 'major'))) confidence = Math.min(confidence, 0.4)
  if (unique.length < 3) confidence = Math.min(confidence, 0.55)
  if (unique.every(h => h.quality === 'thirdless')) confidence = Math.min(confidence, 0.35)
  confidence = Number(Math.max(0, Math.min(1, confidence)).toFixed(2))
  const diatonicFitRatio = Number(best.fitRatio.toFixed(2))
  // Apply output policy only after ranking, mode, confidence, and fit are final.
  // Root spelling only: b5/#11 and slash basses are not key-signature hints.
  const roots = [...new Set(occurrences.map(o => o.rootName))]
  const flatHints = roots.filter(root => /[b♭]/.test(root)).length
  const sharpHints = roots.filter(root => /[#♯]/.test(root)).length
  const preferFlats = parentTonic === 6 ? flatHints > sharpHints : FLAT_MAJOR_ROOTS.has(parentTonic)
  const internalKey = pitchClassToNoteName(best.tonic, preferFlats) + (best.minor ? 'm' : '')
  // Generated note names are valid; normalization cannot return null here.
  const key = normalizeSongKey(internalKey, preferFlats)!
  const formattedKey = `${key} Major` as const
  // Gb's relative minor is Ebm; F#'s is D#m. Other pairs follow the family.
  const minorName = `${pitchClassToNoteName(minorTonic, preferFlats)}m`
  const formattedRelativeMinor = `${minorName.slice(0, -1)} minor`
  return {
    key, formattedKey, relativeMinor: minorName, formattedRelativeMinor,
    confidence, diatonicFitRatio, chordsDetected: distinctChords,
    relative_minor: formattedRelativeMinor, diatonic_fit_ratio: diatonicFitRatio,
    chords_detected: distinctChords,
  }
}

/**
 * Parses ChordPro-style bracketed inline chords (e.g. [G]Amazing [C]grace) into structured Section[].
 */
function parseChordProText(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  let currentSection: Section = { type: 'Other', label: '', lines: [] }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue

    const header = detectSectionHeader(line)
    if (header) {
      if (currentSection.lines.length > 0 || currentSection.label) {
        sections.push(currentSection)
      }
      currentSection = { type: header.type, label: header.label, lines: [] }
      continue
    }

    const chordRegex = /\[([A-G][#b♯♭]?[^\]\s]*)\]/g
    let match: RegExpExecArray | null
    let plainText = ''
    let lastIndex = 0
    const chords: Array<{ pos: number; chord: string }> = []

    while ((match = chordRegex.exec(line)) !== null) {
      const precedingText = line.substring(lastIndex, match.index)
      plainText += precedingText
      const pos = plainText.length
      chords.push({ pos, chord: match[1] })
      lastIndex = match.index + match[0].length
    }
    plainText += line.substring(lastIndex)

    if (chords.length > 0) {
      currentSection.lines.push({
        kind: 'lyric',
        text: plainText,
        chords,
      })
    } else {
      currentSection.lines.push({
        kind: 'lyric',
        text: line,
        chords: [],
      })
    }
  }

  if (currentSection.lines.length > 0 || currentSection.label) {
    sections.push(currentSection)
  }

  return sections
}

/**
 * Detects song key from raw chord sheet text.
 */
export function detectSongKey(chordSheetText: string): KeyDetectionResult | null {
  if (!chordSheetText || !chordSheetText.trim()) return null

  // If text contains ChordPro-style inline bracketed chords like [G]word [C]word
  if (/\[[A-G][#b♯♭]?[^\]\s]*\]/.test(chordSheetText)) {
    const chordProSections = parseChordProText(chordSheetText)
    const chordProResult = detectSongKeyFromSections(chordProSections)
    if (chordProResult) return chordProResult
  }

  const sections = normalizeSongText(chordSheetText)
  return detectSongKeyFromSections(sections)
}

/**
 * Python-style named alias matching the exact prompt signature.
 */
export function detect_song_key(chord_sheet_text: string): KeyDetectionResult | null {
  return detectSongKey(chord_sheet_text)
}
