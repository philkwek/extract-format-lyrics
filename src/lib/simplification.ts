import type { Song } from '../types/song'
import type { SimplifyResponse } from './api'

/**
 * Merges only official simplification fields. Original sections, chord
 * positions, capo, order, user edits and session state are left untouched.
 * A source-provided official chart is never replaced by generated content.
 */
export function mergeOfficialSimplification(song: Song, response: SimplifyResponse): Song {
  if (response.status !== 'ok') return song
  if (!response.simplifiedSections?.length) return song
  if (song.simplifiedSource === 'official' && song.simplifiedSections?.length) return song

  return {
    ...song,
    simplifiedSections: response.simplifiedSections,
    simplifiedFlow: response.simplifiedFlow,
    simplifiedSource: 'official',
    simplificationPending: false,
  }
}
