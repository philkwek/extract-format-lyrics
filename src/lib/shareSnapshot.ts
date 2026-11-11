import type { SessionSongItem } from './sessionStore'
import type { SharedSetSnapshot, Song } from '../types/song'

export class ShareSnapshotError extends Error {}

export function snapshotEntry(item: SessionSongItem, song: Song) {
  return {
    entryId: item.entryId || (() => { throw new ShareSnapshotError('Set entry is missing an identifier. Please reload and try again.') })(),
    song,
    customSections: item.customSections,
    customFlow: item.customFlow,
    customSimplifiedSections: item.customSimplifiedSections,
    customSimplifiedFlow: item.customSimplifiedFlow,
    targetKey: item.targetKey,
    padKeyMode: item.padKeyMode,
    customPadKey: item.customPadKey,
    simplified: item.simplified ?? false,
  }
}

export function sessionSongsFromSnapshot(snapshot: SharedSetSnapshot): SessionSongItem[] {
  return snapshot.songs.map(({ entryId, song, customSections, customFlow, customSimplifiedSections, customSimplifiedFlow, targetKey, padKeyMode, customPadKey, simplified }) => ({
    entryId,
    url: song.sourceUrl,
    title: song.title,
    artist: song.artist,
    customSections,
    customFlow,
    customSimplifiedSections,
    customSimplifiedFlow,
    targetKey,
    padKeyMode,
    customPadKey,
    simplified: simplified ?? false,
  }))
}
