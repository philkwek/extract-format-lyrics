import { parseChord, noteToIndex } from './chords.js'
import { classifyChordQuality, type SimplifiedChordQuality } from './simplifyChords.js'
import { normalizeSongText, detectSectionHeader } from './normalizer.js'
import type { Section } from './types.js'

export interface KeyDetectionResult {
  /** Standard concise key symbol used in the app, e.g. "E" or "C#m" */
  key: string
  /** Formatted key name, e.g. "E Major" or "C# minor" */
  formattedKey: string
  /** Concise relative minor symbol, e.g. "C#m" */
  relativeMinor: string
  /** Formatted relative minor name, e.g. "C# minor" */
  formattedRelativeMinor: string
  /** Confidence score between 0.0 and 1.0 */
  confidence: number
  /** Ratio of detected unique chords that fit the diatonic key (0.0 to 1.0) */
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

interface DetectedChordOccurrence {
  rawChord: string
  root: number
  quality: SimplifiedChordQuality
  sectionType: string
  isFirstInSection: boolean
  isLastInSection: boolean
  isFirstInSong: boolean
  isLastInSong: boolean
}

/**
 * Diatonic degree definition relative to major tonic T (0-11):
 * [semitone offset from T, quality]
 */
const MAJOR_DIATONIC_DEGREES: Array<[number, SimplifiedChordQuality]> = [
  [0, 'major'], // I
  [2, 'minor'], // ii
  [4, 'minor'], // iii
  [5, 'major'], // IV
  [7, 'major'], // V
  [9, 'minor'], // vi
  [11, 'minor'], // vii° (treated as minor in simplified triads)
]

/**
 * Checks if a given chord (root pitch class and quality) is strictly diatonic in major key T.
 */
function isDiatonicInMajorKey(root: number, quality: SimplifiedChordQuality, majorTonic: number): boolean {
  return MAJOR_DIATONIC_DEGREES.some(
    ([offset, degQuality]) => (majorTonic + offset) % 12 === root && quality === degQuality
  )
}

/**
 * Extracts and normalizes chord occurrences with section and positional context from Section[].
 */
function extractChordOccurrences(sections: Section[]): DetectedChordOccurrence[] {
  const occurrences: DetectedChordOccurrence[] = []

  for (const section of sections) {
    const sectionChords: Array<{ raw: string; root: number; quality: SimplifiedChordQuality }> = []

    for (const line of section.lines) {
      if (line.kind === 'lyric') {
        for (const cp of line.chords) {
          const parsed = parseChord(cp.chord)
          if (!parsed) continue
          const quality = classifyChordQuality(parsed.quality)
          if (!quality) continue
          sectionChords.push({ raw: cp.chord, root: parsed.root, quality })
        }
      } else if (line.kind === 'chords-only') {
        for (const chordToken of line.chords) {
          const parsed = parseChord(chordToken)
          if (!parsed) continue
          const quality = classifyChordQuality(parsed.quality)
          if (!quality) continue
          sectionChords.push({ raw: chordToken, root: parsed.root, quality })
        }
      }
    }

    const count = sectionChords.length
    for (let i = 0; i < count; i++) {
      const c = sectionChords[i]
      occurrences.push({
        rawChord: c.raw,
        root: c.root,
        quality: c.quality,
        sectionType: section.type,
        isFirstInSection: i === 0,
        isLastInSection: i === count - 1,
        isFirstInSong: occurrences.length === 0,
        isLastInSong: false, // will update after full traversal
      })
    }
  }

  if (occurrences.length > 0) {
    occurrences[occurrences.length - 1].isLastInSong = true
  }

  return occurrences
}

/**
 * Determines the most likely musical key given structured Section[] data.
 */
export function detectSongKeyFromSections(sections: Section[]): KeyDetectionResult | null {
  const occurrences = extractChordOccurrences(sections)
  if (occurrences.length === 0) {
    return null
  }

  // Deduplicate chords detected in the song
  const rawChordsSeen = new Set<string>()
  const distinctChords: string[] = []
  const uniqueHarmonies = new Map<string, { root: number; quality: SimplifiedChordQuality }>()

  let flatHintCount = 0
  let sharpHintCount = 0

  for (const occ of occurrences) {
    if (!rawChordsSeen.has(occ.rawChord)) {
      rawChordsSeen.add(occ.rawChord)
      distinctChords.push(occ.rawChord)
    }

    if (occ.rawChord.includes('b') || occ.rawChord.includes('♭')) flatHintCount++
    if (occ.rawChord.includes('#') || occ.rawChord.includes('♯')) sharpHintCount++

    const keySig = `${occ.root}:${occ.quality}`
    if (!uniqueHarmonies.has(keySig)) {
      uniqueHarmonies.set(keySig, { root: occ.root, quality: occ.quality })
    }
  }

  const uniqueList = Array.from(uniqueHarmonies.values())

  // Whole-step major pair heuristic:
  // If two major chords are separated by 2 semitones, they are strong candidates for IV and V.
  // Candidate tonic I = (IV - 5 + 12) % 12
  const wholeStepPairs: number[] = []
  const majorRoots = new Set(uniqueList.filter((c) => c.quality === 'major').map((c) => c.root))

  for (const root of majorRoots) {
    const fifthCandidate = (root + 2) % 12
    if (majorRoots.has(fifthCandidate)) {
      // root is IV, fifthCandidate is V
      const tonic = (root - 5 + 12) % 12
      wholeStepPairs.push(tonic)
    }
  }

  // Score all 12 major parent keys
  interface ParentKeyCandidate {
    tonic: number
    fitRatio: number
    score: number
  }

  const parentCandidates: ParentKeyCandidate[] = []

  for (let tonic = 0; tonic < 12; tonic++) {
    let diatonicMatches = 0

    for (const h of uniqueList) {
      if (isDiatonicInMajorKey(h.root, h.quality, tonic)) {
        diatonicMatches++
      } else {
        // Allow harmonic minor V chord (major V in relative minor = tonic + 4)
        if (h.root === (tonic + 4) % 12 && h.quality === 'major') {
          diatonicMatches += 0.8
        }
      }
    }

    const fitRatio = Math.min(1.0, diatonicMatches / uniqueList.length)
    let score = fitRatio

    // Whole-step IV-V heuristic bonus
    if (wholeStepPairs.includes(tonic)) {
      score += 0.4
    }

    // Confirmation if the major I tonic chord itself is present
    if (uniqueList.some((h) => h.root === tonic && h.quality === 'major')) {
      score += 0.2
    }

    // Positional and frequency evidence for candidate tonal center (major tonic or relative minor tonic)
    const relMinor = (tonic + 9) % 12
    const firstOcc = occurrences[0]
    const lastOcc = occurrences[occurrences.length - 1]

    if (firstOcc) {
      if (firstOcc.root === tonic && firstOcc.quality === 'major') score += 0.25
      else if (firstOcc.root === relMinor && firstOcc.quality === 'minor') score += 0.25
    }

    if (lastOcc) {
      if (lastOcc.root === tonic && lastOcc.quality === 'major') score += 0.2
      else if (lastOcc.root === relMinor && lastOcc.quality === 'minor') score += 0.2
    }

    // Section start frequency
    const sectionStartCount = occurrences.filter(
      (o) => o.isFirstInSection && ((o.root === tonic && o.quality === 'major') || (o.root === relMinor && o.quality === 'minor'))
    ).length
    score += Math.min(0.2, sectionStartCount * 0.1)

    // Chorus start frequency
    const chorusStartCount = occurrences.filter(
      (o) => o.isFirstInSection && o.sectionType.toLowerCase().includes('chorus') && ((o.root === tonic && o.quality === 'major') || (o.root === relMinor && o.quality === 'minor'))
    ).length
    score += Math.min(0.2, chorusStartCount * 0.1)

    // Overall tonic frequency
    if (occurrences.length > 0) {
      const tonicOccCount = occurrences.filter(
        (o) => (o.root === tonic && o.quality === 'major') || (o.root === relMinor && o.quality === 'minor')
      ).length
      score += 0.15 * (tonicOccCount / occurrences.length)
    }

    parentCandidates.push({ tonic, fitRatio, score })
  }

  parentCandidates.sort((a, b) => b.score - a.score)
  const bestParent = parentCandidates[0]
  const parentTonic = bestParent.tonic
  const relativeMinorTonic = (parentTonic + 9) % 12

  // Mode Disambiguation: Major (parentTonic) vs. Relative Minor (relativeMinorTonic)
  let majorTonicScore = 0
  let minorTonicScore = 0

  const hasMajorTonic = uniqueList.some((h) => h.root === parentTonic && h.quality === 'major')
  const hasMinorTonic = uniqueList.some((h) => h.root === relativeMinorTonic && h.quality === 'minor')

  // Check if harmonic minor V chord is present (e.g. G# major for C#m, or E major for Am)
  const harmonicMinorV = (relativeMinorTonic + 7) % 12
  const hasHarmonicMinorV = uniqueList.some((h) => h.root === harmonicMinorV && h.quality === 'major')

  // Check if primary major triads I, IV, V are all present
  const hasIV = uniqueList.some((h) => h.root === (parentTonic + 5) % 12 && h.quality === 'major')
  const hasV = uniqueList.some((h) => h.root === (parentTonic + 7) % 12 && h.quality === 'major')
  const hasAllPrimaryMajor = hasMajorTonic && hasIV && hasV

  // If major tonic is absent but minor tonic is present, minor has a strong head start
  if (!hasMajorTonic && hasMinorTonic) {
    minorTonicScore += 5.0
  } else if (hasMajorTonic && !hasMinorTonic) {
    majorTonicScore += 5.0
  } else if (hasMajorTonic && hasMinorTonic) {
    // When both are present, count major vs minor triads in the song
    const majorCount = uniqueList.filter((h) => h.quality === 'major').length
    const minorCount = uniqueList.filter((h) => h.quality === 'minor').length
    if (majorCount > minorCount) {
      majorTonicScore += 2.0
    } else if (minorCount > majorCount) {
      minorTonicScore += 2.0
    }

    if (hasAllPrimaryMajor) {
      majorTonicScore += 3.0
    }
  }

  if (hasHarmonicMinorV) {
    minorTonicScore += 4.0
  }

  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i]
    let weight = 1.0

    // Chorus weighting
    if (occ.sectionType.toLowerCase().includes('chorus')) {
      weight = 2.0
    }

    let chordScore = weight
    if (occ.isFirstInSong) chordScore += 1.5
    if (occ.isLastInSong) chordScore += 2.5
    if (occ.isFirstInSection) chordScore += 1.0
    if (occ.isLastInSection) chordScore += 1.0

    // Cadence check: V -> I authentic resolution
    if (i > 0) {
      const prev = occurrences[i - 1]
      // V of Major (parentTonic + 7) -> I (parentTonic)
      if (prev.root === (parentTonic + 7) % 12 && prev.quality === 'major' && occ.root === parentTonic && occ.quality === 'major') {
        majorTonicScore += 3.0 * weight
      }
      // V of Minor (harmonic or natural) -> i (relativeMinorTonic)
      if (prev.root === harmonicMinorV && occ.root === relativeMinorTonic && occ.quality === 'minor') {
        minorTonicScore += 3.5 * weight
      }
      // VII of Minor (parentTonic + 7, major) -> i (relativeMinorTonic)
      if (prev.root === (parentTonic + 7) % 12 && occ.root === relativeMinorTonic && occ.quality === 'minor') {
        minorTonicScore += 2.0 * weight
      }
    }

    if (occ.root === parentTonic && occ.quality === 'major') {
      majorTonicScore += chordScore
    } else if (occ.root === relativeMinorTonic && occ.quality === 'minor') {
      minorTonicScore += chordScore
    }
  }

  // Decide mode: minor wins if its weighted score exceeds major
  const isMinor = minorTonicScore > majorTonicScore
  const chosenTonic = isMinor ? relativeMinorTonic : parentTonic

  // Accidental preference (Flats vs Sharps)
  const preferFlats = FLAT_MAJOR_ROOTS.has(parentTonic) || flatHintCount > sharpHintCount

  const majorName = pitchClassToNoteName(parentTonic, preferFlats)
  const minorRootName = pitchClassToNoteName(relativeMinorTonic, preferFlats)
  const minorName = `${minorRootName}m`

  const conciseKey = isMinor ? minorName : majorName
  const formattedKey = isMinor
    ? `${minorRootName} minor`
    : `${majorName} Major`
  const relativeMinorFormatted = `${minorRootName} minor`

  // Calculate confidence
  const runnerUpScore = parentCandidates[1]?.score ?? 0
  const scoreMargin = Math.max(0, bestParent.score - runnerUpScore)
  const tonicPresent = occurrences.some((o) => o.root === chosenTonic)
  const confidence = Math.min(
    1.0,
    Math.max(0.2, Number((0.5 * bestParent.fitRatio + 0.3 * Math.min(1.0, scoreMargin) + (tonicPresent ? 0.2 : 0.05)).toFixed(2)))
  )

  const diatonicFitRatio = Number(bestParent.fitRatio.toFixed(2))

  return {
    key: conciseKey,
    formattedKey,
    relativeMinor: minorName,
    formattedRelativeMinor: relativeMinorFormatted,
    confidence,
    diatonicFitRatio,
    chordsDetected: distinctChords,
    // snake_case aliases
    relative_minor: relativeMinorFormatted,
    diatonic_fit_ratio: diatonicFitRatio,
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
