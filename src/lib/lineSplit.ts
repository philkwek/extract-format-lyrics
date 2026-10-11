import type { Line, Section } from '../types/song'

type LyricLine = Extract<Line, { kind: 'lyric' }>

/** Returns the start index of every word that can begin a new lyric line. */
export function getLyricSplitPositions(line: Line): number[] {
  if (line.kind !== 'lyric') return []

  const positions: number[] = []
  for (let index = 1; index < line.text.length; index++) {
    if (/\s/.test(line.text[index - 1]) && !/\s/.test(line.text[index])) {
      positions.push(index)
    }
  }
  return positions
}

/**
 * Splits a lyric line at the start of a word. Whitespace stays in the first
 * line so joining the result later restores the exact original lyric string.
 */
export function splitLyricLine(line: Line, splitAt: number): [LyricLine, LyricLine] | null {
  if (line.kind !== 'lyric' || !getLyricSplitPositions(line).includes(splitAt)) {
    return null
  }

  return [
    {
      kind: 'lyric',
      text: line.text.slice(0, splitAt),
      ...(line.splitFromPrevious ? { splitFromPrevious: true } : {}),
      chords: line.chords
        .filter((chord) => chord.pos < splitAt)
        .map((chord) => ({ ...chord })),
    },
    {
      kind: 'lyric',
      text: line.text.slice(splitAt),
      splitFromPrevious: true,
      chords: line.chords
        .filter((chord) => chord.pos >= splitAt)
        .map((chord) => ({ ...chord, pos: chord.pos - splitAt })),
    },
  ]
}

/** Rejoins two adjacent lyric lines and restores the second line's chord offsets. */
export function mergeLyricLines(first: Line, second: Line): LyricLine | null {
  if (first.kind !== 'lyric' || second.kind !== 'lyric') return null

  return {
    kind: 'lyric',
    text: first.text + second.text,
    chords: [
      ...first.chords.map((chord) => ({ ...chord })),
      ...second.chords.map((chord) => ({ ...chord, pos: chord.pos + first.text.length })),
    ],
  }
}

/** Returns updated sections after splitting one lyric line, or null for an invalid request. */
export function splitSectionLyricLine(
  sections: Section[],
  sectionIndex: number,
  lineIndex: number,
  splitAt: number
): Section[] | null {
  const line = sections[sectionIndex]?.lines[lineIndex]
  if (!line) return null
  const splitLines = splitLyricLine(line, splitAt)
  if (!splitLines) return null

  return sections.map((section, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return section
    return {
      ...section,
      lines: [...section.lines.slice(0, lineIndex), ...splitLines, ...section.lines.slice(lineIndex + 1)],
    }
  })
}

/** Merges a lyric line with the adjacent lyric line immediately before it. */
export function mergeSectionLyricLineWithPrevious(
  sections: Section[],
  sectionIndex: number,
  lineIndex: number
): Section[] | null {
  if (lineIndex <= 0) return null
  const section = sections[sectionIndex]
  const mergedLine = section && mergeLyricLines(section.lines[lineIndex - 1], section.lines[lineIndex])
  if (!mergedLine) return null

  return sections.map((currentSection, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return currentSection
    return {
      ...currentSection,
      lines: [
        ...currentSection.lines.slice(0, lineIndex - 1),
        mergedLine,
        ...currentSection.lines.slice(lineIndex + 1),
      ],
    }
  })
}
