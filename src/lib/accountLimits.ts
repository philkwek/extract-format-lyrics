import type { Session } from './sessionStore'

export const ACCOUNT_MAX_SETS = 100
export const ACCOUNT_MAX_SONGS = 30
export const SET_DATA_MAX = 500_000
export const SONG_DATA_MAX = 200_000

export function checkSetLimits(session: Session): string | null {
  if (session.songs.length > ACCOUNT_MAX_SONGS) {
    return `This set has more than ${ACCOUNT_MAX_SONGS} songs, so it can't be saved to your account.`
  }
  const data = JSON.stringify({
    name: session.name,
    createdAt: session.createdAt,
    songs: session.songs,
  })
  if (data.length > SET_DATA_MAX) {
    return 'This set is too big to save to your account.'
  }
  return null
}
