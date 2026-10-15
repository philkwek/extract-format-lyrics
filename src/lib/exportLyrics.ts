import type { SessionSongItem } from './sessionStore'
import type { Song, Section, SharedLyricsPayload, SharedLyricsSong, SharedLyricsSection } from '../types/song'

export const MAX_SHARED_LYRICS_SONGS = 15

export class ShareLyricsError extends Error {}

/**
 * Extracts structured lyric sections from a single song item.
 *
 * Specifics:
 * - Respects saved normal/simplified selection and custom sections.
 * - Preserves custom text, section order, internal blank lines, and empty custom arrangements.
 * - Strips outer brackets and cleans section labels.
 * - Excludes chords-only lines, tab lines, and raw chords; extracts only lyric text lines.
 * - Deduplicates repeated lyric sections within the song using case/whitespace normalization.
 * - Preserves label-only instrumental/intro sections without lyrics.
 */
export function extractSongLyrics(
  item: SessionSongItem,
  song: Song,
  isSimplified = false
): SharedLyricsSong {
  const entryId = item.entryId || song.id
  const title = song.title || item.title || 'Untitled Song'

  // Determine active sections as seen by the musician (respecting custom arrangements)
  const activeSections: Section[] =
    isSimplified && song.simplifiedSections && song.simplifiedSections.length > 0
      ? (item.customSimplifiedSections ?? song.simplifiedSections)
      : (item.customSections ?? song.sections ?? [])

  const structuredSections: SharedLyricsSection[] = []
  const seenLyricSignatures = new Set<string>()
  const seenEmptySignatures = new Set<string>()
  const seenLabelsWithLyrics = new Set<string>()

  for (const section of activeSections) {
    const cleanLabel = section.label.replace(/^\[+|\]+$/g, '').trim() || section.type || 'Section'
    const labelLower = cleanLabel.toLowerCase()

    // Extract lyric lines (excluding chord-only and tab lines)
    const lyricLines: string[] = []
    for (const line of section.lines) {
      if (line.kind === 'lyric') {
        lyricLines.push(line.text)
      }
    }

    // Trim leading and trailing empty lines while preserving internal blank lines
    const trimmedLines = [...lyricLines]
    while (trimmedLines.length > 0 && !trimmedLines[0].trim()) {
      trimmedLines.shift()
    }
    while (trimmedLines.length > 0 && !trimmedLines[trimmedLines.length - 1].trim()) {
      trimmedLines.pop()
    }

    if (trimmedLines.length > 0) {
      // Normalize lyric content for duplicate detection (lowercase, normalize whitespace)
      const lyricSignature = trimmedLines
        .map((l) => l.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean)
        .join('\n')

      if (seenLyricSignatures.has(lyricSignature)) {
        // Duplicate section lyrics within this song! Skip.
        continue
      }

      seenLyricSignatures.add(lyricSignature)
      seenLabelsWithLyrics.add(labelLower)
      structuredSections.push({
        label: cleanLabel,
        lines: trimmedLines,
      })
    } else {
      // Section with no lyrics (e.g. [Intro] or [Instrumental])
      if (seenLabelsWithLyrics.has(labelLower) || seenEmptySignatures.has(labelLower)) {
        continue
      }

      seenEmptySignatures.add(labelLower)
      structuredSections.push({
        label: cleanLabel,
        lines: [],
      })
    }
  }

  return {
    entryId,
    title,
    sections: structuredSections,
  }
}

/**
 * Builds a validated SharedLyricsPayload from a session and song data resolver.
 */
export function createSharedLyricsPayload(
  session: { name: string; songs: SessionSongItem[] },
  getSong: (item: SessionSongItem) => Song | null | undefined,
  getSongSimplifiedPreference?: (item: SessionSongItem, song: Song) => boolean
): SharedLyricsPayload {
  if (session.songs.length === 0) {
    throw new ShareLyricsError('This set has no songs that can be shared.')
  }
  if (session.songs.length > MAX_SHARED_LYRICS_SONGS) {
    throw new ShareLyricsError(`Shared sets have a limit of ${MAX_SHARED_LYRICS_SONGS} songs. Remove songs before sharing.`)
  }
  if (session.songs.some((item) => item.status !== 'ok')) {
    throw new ShareLyricsError('All songs must finish loading successfully before this set can be shared.')
  }

  const songs: SharedLyricsSong[] = session.songs.map((item) => {
    const song = getSong(item)
    if (!song) {
      throw new ShareLyricsError(`"${item.title || item.url}" is not available locally and cannot be shared.`)
    }
    const isSimplified = getSongSimplifiedPreference
      ? getSongSimplifiedPreference(item, song)
      : (item.simplified ?? false)

    return extractSongLyrics(item, song, isSimplified)
  })

  return {
    v: 1,
    name: session.name,
    songs,
  }
}

/**
 * Builds a SharedLyricsPayload from a session and songsData Map.
 */
export function buildSharedLyricsPayload(
  session: { name: string; songs: SessionSongItem[] },
  songsData: Map<string, Song>
): SharedLyricsPayload {
  return createSharedLyricsPayload(
    session,
    (item) => (item.entryId ? songsData.get(item.entryId) : undefined) ?? songsData.get(item.url) ?? null,
    (item) => item.simplified ?? false
  )
}

/**
 * Formats a SharedLyricsPayload into plain copy-pastable text.
 */
export function formatLyricsPayloadAsText(payload: SharedLyricsPayload): string {
  const songBlocks: string[] = []

  for (const song of payload.songs) {
    if (song.sections.length === 0) continue

    const sectionBlocks: string[] = []
    for (const section of song.sections) {
      const header = `[${section.label}]`
      if (section.lines.length > 0) {
        sectionBlocks.push(`${header}\n${section.lines.join('\n')}`)
      } else {
        sectionBlocks.push(header)
      }
    }

    if (sectionBlocks.length > 0) {
      songBlocks.push(`${song.title}\n\n${sectionBlocks.join('\n\n')}`)
    }
  }

  return songBlocks.join('\n\n\n')
}

/**
 * Legacy/wrapper function that formats setlist lyrics into plain text.
 */
export function formatSetlistLyrics(
  songs: SessionSongItem[],
  songsData: Map<string, Song>,
  getSongSimplifiedPreference?: (item: SessionSongItem, song: Song) => boolean
): string {
  const validSongs = songs.filter((s) => s.status !== 'error')
  const payloadSongs: SharedLyricsSong[] = []

  for (const item of validSongs) {
    const loadedSong = (item.entryId ? songsData.get(item.entryId) : undefined) ?? songsData.get(item.url)
    if (!loadedSong) continue

    const isSimplified = getSongSimplifiedPreference
      ? getSongSimplifiedPreference(item, loadedSong)
      : (item.simplified ?? false)
    payloadSongs.push(extractSongLyrics(item, loadedSong, isSimplified))
  }

  return formatLyricsPayloadAsText({
    v: 1,
    name: '',
    songs: payloadSongs,
  })
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
