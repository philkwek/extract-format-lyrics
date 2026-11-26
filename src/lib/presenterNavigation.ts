import type { SharedLyricsSong } from '../types/song'
import type { PresenterView } from './presenterSettings'

/** Every song starts with a blank section: no lyrics on screen, the title stays. */
export const BLANK_SECTION = -1

export interface PresenterPosition {
  entryId: string | null
  sectionIndex: number
}

/**
 * Moves through the set for the arrow keys and clicker buttons. Sections view walks
 * the blank section and every section, and wraps onto the next or previous song; whole view moves by song.
 */
export function stepPresenter(
  songs: SharedLyricsSong[],
  position: PresenterPosition,
  view: PresenterView,
  direction: 1 | -1,
): PresenterPosition {
  if (songs.length === 0) return position

  const found = songs.findIndex((song) => song.entryId === position.entryId)
  const songIndex = found === -1 ? 0 : found
  const song = songs[songIndex]

  if (view === 'whole') {
    const nextSongIndex = Math.min(songs.length - 1, Math.max(0, songIndex + direction))
    return { entryId: songs[nextSongIndex].entryId, sectionIndex: 0 }
  }

  const lastSection = song.sections.length - 1
  const currentSection = Math.min(lastSection, Math.max(BLANK_SECTION, position.sectionIndex))
  const nextSection = currentSection + direction
  if (nextSection >= BLANK_SECTION && nextSection <= lastSection) {
    return { entryId: song.entryId, sectionIndex: nextSection }
  }

  const nextSongIndex = songIndex + direction
  if (nextSongIndex < 0 || nextSongIndex >= songs.length) {
    return { entryId: song.entryId, sectionIndex: currentSection }
  }
  const nextSong = songs[nextSongIndex]
  return {
    entryId: nextSong.entryId,
    sectionIndex: direction === 1 ? BLANK_SECTION : nextSong.sections.length - 1,
  }
}
