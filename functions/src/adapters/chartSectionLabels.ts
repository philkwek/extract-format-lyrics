const ORDINAL_VERSES: Record<string, string> = {
  first: '1',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  '1st': '1',
  '2nd': '2',
  '3rd': '3',
  '4th': '4',
  '5th': '5',
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Converts the section labels used by both Worship Chords sites into headers
 * that `normalizeSongText` recognizes. Returns null for non-label lines.
 */
export function normalizeSectionLabel(line: string): string | null {
  const label = line.trim().replace(/\s+/g, ' ')
  if (!label || label.length > 40) return null
  const lower = label.toLowerCase()

  const ordinalVerse = lower.match(
    /^(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+verse$/
  )
  if (ordinalVerse) return `Verse ${ORDINAL_VERSES[ordinalVerse[1]]}`

  const verse = lower.match(/^verse(?:\s*(\d+))?$/)
  if (verse) return verse[1] ? `Verse ${verse[1]}` : 'Verse'

  const preChorus = lower.match(/^pre[- ]?chorus(?:\s*(\d+))?$/)
  if (preChorus) return preChorus[1] ? `Pre-Chorus ${preChorus[1]}` : 'Pre-Chorus'

  const chorus = lower.match(/^chorus(?:\s*(\d+))?(?:\s+repeat)?$/)
  if (chorus) return chorus[1] ? `Chorus ${chorus[1]}` : 'Chorus'

  const bridge = lower.match(/^bridge(?:\s*(\d+))?(?:\s+repeat)?$/)
  if (bridge) return bridge[1] ? `Bridge ${bridge[1]}` : 'Bridge'

  if (/^intro(?:\s+\d+)?(?:\s+repeat)?$/.test(lower)) return 'Intro'
  if (/^outro(?:\s+\d+)?(?:\s+repeat)?$/.test(lower)) return 'Outro'
  if (/^(?:instrumental|interlude)(?:\s+\d+)?$/.test(lower)) return 'Instrumental'

  const other = lower.match(/^(tag|ending|refrain|turnaround)(?:\s+\d+)?$/)
  if (other) return `${titleCase(other[1])}:`

  return null
}

export interface ChartSectionOptions {
  /** Remove the "… Bible Verse:" reference block appended after some charts. */
  dropTrailingBibleVerse?: boolean
}

/** Normalizes section labels and optionally strips a trailing Bible-verse block. */
export function normalizeChartSectionLabels(
  content: string,
  options: ChartSectionOptions = {}
): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const normalized = lines.map((line) => normalizeSectionLabel(line) ?? line)
  if (options.dropTrailingBibleVerse) {
    const bibleVerseIndex = normalized.findIndex((line) =>
      /Bible Verse:\s*$/i.test(line.trim())
    )
    if (bibleVerseIndex >= 0) normalized.length = bibleVerseIndex
  }
  return normalized.join('\n').trim()
}
