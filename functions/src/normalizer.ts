import type { Section, SectionType, Line, ChordPlacement } from './types.js'
import { isChord, isChordLine } from './chords.js'

const SECTION_HEADER_PATTERNS: Array<{ regex: RegExp; type: SectionType }> = [
  { regex: /^\s*\[?(?:intro)(?:[\s:\]]|$)/i, type: 'Intro' },
  { regex: /^\s*\[?(?:verse\s*\d*|v\d+)(?:[\s:\]]|$)/i, type: 'Verse' },
  { regex: /^\s*\[?(?:pre[- ]?chorus\s*\d*)(?:[\s:\]]|$)/i, type: 'Pre-Chorus' },
  { regex: /^\s*\[?(?:chorus\s*\d*)(?:[\s:\]]|$)/i, type: 'Chorus' },
  { regex: /^\s*\[?(?:bridge\s*\d*)(?:[\s:\]]|$)/i, type: 'Bridge' },
  { regex: /^\s*\[?(?:outro)(?:[\s:\]]|$)/i, type: 'Outro' },
  { regex: /^\s*\[?(?:instrumental|interlude)(?:[\s:\]]|$)/i, type: 'Instrumental' },
]

export function detectSectionHeader(line: string): { type: SectionType; label: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Check if it's formatted like a header: e.g. [Verse 1], Verse 1:, VERSE 1, (Bridge), Verse1, Chorus
  const isBracketed = /^\[.+\]$/.test(trimmed) || /^\(.+\)$/.test(trimmed)
  const hasColon = /:$/.test(trimmed)

  for (const { regex, type } of SECTION_HEADER_PATTERNS) {
    if (regex.test(trimmed)) {
      const label = trimmed.replace(/^[[(]\s*|\s*[\]):]$/g, '').trim()
      return { type, label: label || type }
    }
  }

  // Catch other bracketed headers: e.g. [Hook], [Refrain], [Solo]
  if (isBracketed || (hasColon && trimmed.split(/\s+/).length <= 4)) {
    const clean = trimmed.replace(/^[[(]\s*|\s*[\]):]$/g, '').trim()
    if (clean && !isChord(clean)) {
      return { type: 'Other', label: clean }
    }
  }

  return null
}

export function isTabLine(line: string): boolean {
  // Tab lines typically start with e|-, B|-, G|-, D|-, A|-, E|-, or contain multiple string fret dashes
  return /^[eEbBgGdDaA]\|[-0-9hpbr/\\~s\s|]+$/.test(line.trim()) || /\|[-0-9\s|]{8,}\|/.test(line.trim())
}

/**
 * Extracts chord placements from a chord line using token regex with character positions.
 */
export function extractChordsWithPositions(chordLine: string): ChordPlacement[] {
  const chords: ChordPlacement[] = []
  // Matches tokens that aren't whitespace or bar lines
  const regex = /\S+/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(chordLine)) !== null) {
    const token = match[0].replace(/[|:]/g, '') // strip bar markers
    if (token && isChord(token)) {
      chords.push({
        pos: match.index,
        chord: token,
      })
    }
  }

  return chords
}

/**
 * Normalizes plain or formatted song text into structured sections and lines.
 */
export function normalizeSongText(rawText: string): Section[] {
  const rawLines = rawText.replace(/\r\n/g, '\n').split('\n').slice(0, 500) // cap at 500 lines

  const sections: Section[] = []
  let currentSection: Section = {
    type: 'Other',
    label: '',
    lines: [],
  }

  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]
    const header = detectSectionHeader(line)

    if (header) {
      if (currentSection.lines.length > 0 || currentSection.label) {
        sections.push(currentSection)
      }
      currentSection = {
        type: header.type,
        label: header.label,
        lines: [],
      }
      i++
      continue
    }

    // Check for tab line
    if (isTabLine(line)) {
      currentSection.lines.push({ kind: 'tab', raw: line })
      i++
      continue
    }

    // Check for chord line
    if (isChordLine(line)) {
      const nextLine = i + 1 < rawLines.length ? rawLines[i + 1] : ''
      const nextHeader = detectSectionHeader(nextLine)

      // If next line is lyrics (not empty, not chord line, not header, not tab)
      if (
        nextLine.trim() &&
        !isChordLine(nextLine) &&
        !nextHeader &&
        !isTabLine(nextLine)
      ) {
        const chords = extractChordsWithPositions(line)
        currentSection.lines.push({
          kind: 'lyric',
          text: nextLine,
          chords,
        })
        i += 2
        continue
      } else {
        // Chords only
        const chordTokens = line
          .split(/\s+/)
          .filter((t) => t && !/^[|:\-.x\d]+$/i.test(t))
          .filter(isChord)

        if (chordTokens.length > 0) {
          currentSection.lines.push({
            kind: 'chords-only',
            chords: chordTokens,
          })
        }
        i++
        continue
      }
    }

    // Plain text line or empty line
    if (line.trim()) {
      currentSection.lines.push({
        kind: 'lyric',
        text: line,
        chords: [],
      })
    } else if (currentSection.lines.length > 0) {
      // Preserve a single blank line between lyric groups within a section
      const lastLine = currentSection.lines[currentSection.lines.length - 1]
      if (lastLine.kind === 'lyric' && lastLine.text !== '') {
        currentSection.lines.push({
          kind: 'lyric',
          text: '',
          chords: [],
        })
      }
    }

    i++
  }

  if (currentSection.lines.length > 0 || currentSection.label) {
    sections.push(currentSection)
  }

  // Deduplicate contiguous identical lines and strip trailing empty lines
  for (const sec of sections) {
    sec.lines = deduplicateSectionLines(sec.lines)
    while (
      sec.lines.length > 0 &&
      sec.lines[sec.lines.length - 1].kind === 'lyric' &&
      (sec.lines[sec.lines.length - 1] as { text: string }).text === ''
    ) {
      sec.lines.pop()
    }
  }

  return sections.filter((s) => s.lines.length > 0)
}

export function areLinesIdentical(a: Line, b: Line): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tab') {
    return a.raw.trim() === (b as { raw: string }).raw.trim()
  }
  if (a.kind === 'chords-only') {
    const bChords = (b as { chords: string[] }).chords
    if (a.chords.length !== bChords.length) return false
    return a.chords.every((c, idx) => c === bChords[idx])
  }
  if (a.kind === 'lyric') {
    const bLyric = b as { text: string; chords: ChordPlacement[] }
    // Text must match exactly
    if (a.text.trim() !== bLyric.text.trim()) return false

    // Allow blank lines without chords to not duplicate
    if (!a.text.trim() && a.chords.length === 0 && bLyric.chords.length === 0) {
      return true
    }

    // Chords and their positions must match identically
    if (a.chords.length !== bLyric.chords.length) return false
    return a.chords.every(
      (c, idx) => c.pos === bLyric.chords[idx].pos && c.chord === bLyric.chords[idx].chord
    )
  }
  return false
}

export function deduplicateSectionLines(lines: Line[]): Line[] {
  const result: Line[] = []
  for (const line of lines) {
    if (result.length === 0) {
      result.push(line)
      continue
    }
    const prev = result[result.length - 1]
    if (!areLinesIdentical(prev, line)) {
      result.push(line)
    }
  }
  return result
}

/**
 * Heuristic key detector when metadata key is not present.
 */
export function inferKeyFromChords(sections: Section[]): string | null {
  const chordSet: string[] = []
  let firstChord: string | null = null
  let lastChord: string | null = null

  for (const s of sections) {
    for (const l of s.lines) {
      if (l.kind === 'lyric') {
        for (const c of l.chords) {
          if (!firstChord) firstChord = c.chord
          lastChord = c.chord
          chordSet.push(c.chord)
        }
      } else if (l.kind === 'chords-only') {
        for (const c of l.chords) {
          if (!firstChord) firstChord = c
          lastChord = c
          chordSet.push(c)
        }
      }
    }
  }

  if (chordSet.length === 0) return null

  // Tally root notes
  const counts = new Map<string, number>()
  for (const chord of chordSet) {
    const root = chord.match(/^[A-G][#b]?/)?.[0]
    if (root) {
      counts.set(root, (counts.get(root) || 0) + 1)
    }
  }

  // Bonus for first and last chords (often the tonic in pop/rock/worship music)
  const firstRoot = firstChord?.match(/^[A-G][#b]?/)?.[0]
  const lastRoot = lastChord?.match(/^[A-G][#b]?/)?.[0]

  let bestKey: string | null = null
  let bestScore = -1

  for (const [root, count] of counts.entries()) {
    let score = count
    if (root === firstRoot) score += 3
    if (root === lastRoot) score += 4
    if (score > bestScore) {
      bestScore = score
      bestKey = root
    }
  }

  // Check if root is predominantly minor
  if (bestKey) {
    const isMinor = chordSet.some((c) => c.startsWith(`${bestKey}m`) && !c.startsWith(`${bestKey}maj`))
    return isMinor ? `${bestKey}m` : bestKey
  }

  return null
}
