import type { SessionSongItem } from './sessionStore'
import type { Song, Section } from '../types/song'

/**
 * Formats all lyrics from a setlist into plain copy-pastable text without chords.
 *
 * Specifics:
 * - Songs are ordered exactly as in the setlist.
 * - Sections match what the musician sees 1:1 (including custom section reordering and deletions).
 * - Each song is titled at the top with its name.
 * - Each section is titled enclosed in "[]" (e.g. [Verse 1], [Chorus]).
 * - Lyrics are extracted without chords attached.
 */
export function formatSetlistLyrics(
  songs: SessionSongItem[],
  songsData: Map<string, Song>,
  getSongSimplifiedPreference?: (songId: string) => boolean
): string {
  const songBlocks: string[] = []

  for (const item of songs) {
    if (item.status === 'error') continue

    const loadedSong = songsData.get(item.url)
    const title = loadedSong?.title || item.title || 'Untitled Song'

    const isSimplified = loadedSong?.id && getSongSimplifiedPreference
      ? getSongSimplifiedPreference(loadedSong.id)
      : false

    // Determine 1:1 active sections as seen by the musician
    const activeSections: Section[] =
      isSimplified && loadedSong?.simplifiedSections && loadedSong.simplifiedSections.length > 0
        ? (item.customSimplifiedSections ?? loadedSong.simplifiedSections)
        : (item.customSections ?? loadedSong?.sections ?? [])

    if (activeSections.length === 0) continue

    const sectionBlocks: string[] = []
    const seenLyricSignatures = new Set<string>()
    const seenEmptySignatures = new Set<string>()
    const seenLabelsWithLyrics = new Set<string>()

    for (const section of activeSections) {
      // Normalize label to be cleanly enclosed in []
      const cleanLabel = section.label.replace(/^\[+|\]+$/g, '').trim() || section.type || 'Section'
      const labelLower = cleanLabel.toLowerCase()
      const header = `[${cleanLabel}]`

      // Extract lyric lines (excluding chord-only and tab lines)
      const lyricLines: string[] = []
      for (const line of section.lines) {
        if (line.kind === 'lyric') {
          lyricLines.push(line.text)
        }
      }

      // Trim leading and trailing empty lines from the section lyrics
      while (lyricLines.length > 0 && !lyricLines[0].trim()) {
        lyricLines.shift()
      }
      while (lyricLines.length > 0 && !lyricLines[lyricLines.length - 1].trim()) {
        lyricLines.pop()
      }

      if (lyricLines.length > 0) {
        // Normalize lyric content for duplicate detection (lowercase, normalize whitespace)
        const lyricSignature = lyricLines
          .map((l) => l.trim().toLowerCase().replace(/\s+/g, ' '))
          .filter(Boolean)
          .join('\n')

        if (seenLyricSignatures.has(lyricSignature)) {
          // Duplicate section lyrics! Omit this duplicate section from the export.
          continue
        }

        seenLyricSignatures.add(lyricSignature)
        seenLabelsWithLyrics.add(labelLower)
        sectionBlocks.push(`${header}\n${lyricLines.join('\n')}`)
      } else {
        // Section with no lyrics (e.g. [Intro] or [Instrumental])
        // If this section label already has lyrics printed, or another identical empty section was already printed, skip.
        if (seenLabelsWithLyrics.has(labelLower) || seenEmptySignatures.has(labelLower)) {
          continue
        }

        seenEmptySignatures.add(labelLower)
        sectionBlocks.push(header)
      }
    }

    if (sectionBlocks.length > 0) {
      songBlocks.push(`${title}\n\n${sectionBlocks.join('\n\n')}`)
    }
  }

  return songBlocks.join('\n\n\n')
}

/**
 * Copies the given text to the clipboard across desktop and mobile devices.
 */
export async function copyLyricsToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback below
    }
  }

  // Fallback using textarea execCommand for environments where Clipboard API is restricted
  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    textArea.style.top = '-999999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const successful = document.execCommand('copy')
    document.body.removeChild(textArea)
    return successful
  } catch {
    return false
  }
}
