import { songCache } from './songCache'
import type { Session, SessionSongItem } from './sessionStore'
import type { SharedSetSnapshot, Song } from '../types/song'

export const MAX_SHARED_SET_SONGS = 15

export class ShareSnapshotError extends Error {}

function snapshotEntry(item: SessionSongItem, song: Song) {
  return {
    entryId: item.entryId || (() => { throw new ShareSnapshotError('Set entry is missing an identifier. Please reload and try again.') })(),
    song,
    customSections: item.customSections,
    customSimplifiedSections: item.customSimplifiedSections,
    targetKey: item.targetKey,
    simplified: item.simplified ?? false,
  }
}

/** Builds one canonical immutable snapshot for every sharing entry point. */
export async function createSharedSetSnapshot(
  session: Session,
  getSong: (url: string) => Promise<Song | null>
): Promise<SharedSetSnapshot> {
  if (session.songs.length === 0) throw new ShareSnapshotError('This set has no songs that can be shared.')
  if (session.songs.length > MAX_SHARED_SET_SONGS) {
    throw new ShareSnapshotError(`Shared sets have a limit of ${MAX_SHARED_SET_SONGS} songs. Remove songs before sharing.`)
  }
  if (session.songs.some((item) => item.status !== 'ok')) {
    throw new ShareSnapshotError('All songs must finish loading successfully before this set can be shared.')
  }

  const songs = await Promise.all(session.songs.map(async (item) => {
    const song = await getSong(item.url)
    if (!song) throw new ShareSnapshotError(`"${item.title || item.url}" is not available locally and cannot be shared.`)
    return snapshotEntry(item, song)
  }))

  return { v: 2, name: session.name, songs }
}

export async function buildSharedSetSnapshot(session: Session): Promise<SharedSetSnapshot> {
  return createSharedSetSnapshot(session, (url) => songCache.getSong(url))
}

export function sessionSongsFromSnapshot(snapshot: SharedSetSnapshot): SessionSongItem[] {
  return snapshot.songs.map(({ entryId, song, customSections, customSimplifiedSections, targetKey, simplified }) => ({
    entryId,
    url: song.sourceUrl,
    title: song.title,
    artist: song.artist,
    status: 'ok',
    customSections,
    customSimplifiedSections,
    targetKey,
    simplified: simplified ?? false,
  }))
}
