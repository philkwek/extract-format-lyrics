import { describe, expect, it } from 'vitest'
import { createSharedSetSnapshot, MAX_SHARED_SET_SONGS, sessionSongsFromSnapshot } from './shareSnapshot'
import type { Session } from './sessionStore'
import type { Song } from '../types/song'

const sourceSong: Song = {
  id: 'song-1', title: 'Song', artist: 'Artist', sourceUrl: 'https://example.test/song', sourceSite: 'test', originalKey: 'C',
  sections: [{ type: 'Verse', label: 'Verse 1', lines: [{ kind: 'lyric', text: 'words', chords: [{ pos: 2, chord: 'G' }] }] }],
  simplifiedSections: [{ type: 'Verse', label: 'Simple', lines: [] }],
}

describe('shared set snapshots', () => {
  it('preserves ordered duplicate entries and their independent musical state', async () => {
    const session: Session = {
      id: 'set', createdAt: 1, name: 'Sunday', songs: [
        { entryId: 'first', url: sourceSong.sourceUrl, status: 'ok', targetKey: 'D', simplified: true },
        { entryId: 'second', url: sourceSong.sourceUrl, status: 'ok', customSections: [], simplified: false },
      ],
    }
    const snapshot = await createSharedSetSnapshot(session, async () => sourceSong)
    expect(snapshot.songs.map((entry) => entry.entryId)).toEqual(['first', 'second'])
    expect(snapshot.songs[0].targetKey).toBe('D')
    expect(snapshot.songs[1].customSections).toEqual([])
    expect(sessionSongsFromSnapshot(snapshot)).toMatchObject(session.songs)
  })

  it('rejects sets above the sharing limit before reading songs', async () => {
    const session: Session = {
      id: 'set', createdAt: 1, name: 'Large',
      songs: Array.from({ length: MAX_SHARED_SET_SONGS + 1 }, (_, i) => ({ entryId: String(i), url: `https://example.test/${i}`, status: 'ok' as const })),
    }
    await expect(createSharedSetSnapshot(session, async () => sourceSong)).rejects.toThrow('limit of 15 songs')
  })
})
