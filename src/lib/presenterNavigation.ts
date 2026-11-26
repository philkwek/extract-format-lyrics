import type { SharedLyricsSong } from '../types/song'

export interface PresenterPosition {
  entryId: string | null
  sectionIndex: number
}

/**
 * Moves through the set for the arrow keys and clicker buttons. Sections view walks
 * every section and wraps onto the next or previous song; whole view moves by song.
 */
export function stepPresenter(
  songs: SharedLyricsSong[],
  position: PresenterPosition,
  view: 'whole' | 'sections',
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

  const lastSection = Math.max(0, song.sections.length - 1)
  const currentSection = Math.min(lastSection, Math.max(0, position.sectionIndex))
  const nextSection = currentSection + direction
  if (nextSection >= 0 && nextSection <= lastSection) {
    return { entryId: song.entryId, sectionIndex: nextSection }
  }

  const nextSongIndex = songIndex + direction
  if (nextSongIndex < 0 || nextSongIndex >= songs.length) {
    return { entryId: song.entryId, sectionIndex: currentSection }
  }
  const nextSong = songs[nextSongIndex]
  return {
    entryId: nextSong.entryId,
    sectionIndex: direction === 1 ? 0 : Math.max(0, nextSong.sections.length - 1),
  }
}
