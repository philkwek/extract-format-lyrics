import { keyOffset } from './keys'
import { transposeSong } from './transpose'
import type { Song, Section } from '../types/song'
import type { SessionSongItem } from './sessionStore'

// Same song, chart and key give the same array, so a page that moves from neighbour to
// active keeps identical sections and does not lay itself out again.
const cache = new WeakMap<Song, Map<string, Section[]>>()

/** The sections a set item shows: its chosen chart, transposed to the item's key. */
export function getSheetSections(
  song: Song,
  item: Pick<SessionSongItem, 'targetKey' | 'simplified'>,
): Section[] {
  const simplified = Boolean(
    item.simplified && song.simplifiedSections && song.simplifiedSections.length > 0,
  )
  const cacheKey = `${simplified ? 's' : 'f'}|${item.targetKey ?? ''}`
  let bySong = cache.get(song)
  const cached = bySong?.get(cacheKey)
  if (cached) return cached

  const sections = simplified && song.simplifiedSections ? song.simplifiedSections : song.sections
  const targetKey = item.targetKey
  const result =
    !targetKey || !song.originalKey || targetKey === song.originalKey
      ? sections
      : transposeSong({ ...song, sections }, keyOffset(song.originalKey, targetKey), targetKey)
          .sections

  if (!bySong) {
    bySong = new Map()
    cache.set(song, bySong)
  }
  bySong.set(cacheKey, result)
  return result
}
