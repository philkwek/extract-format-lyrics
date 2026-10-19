import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveRecentSharedLyrics,
  getRecentSharedLyrics,
  getCachedSharedLyrics,
  removeRecentSharedLyrics,
  clearRecentSharedLyrics,
  resetRecentLyricsStore,
} from '../../src/lib/recentLyricsStore'
import type { SharedLyricsPayload } from '../../src/types/song'

describe('recentLyricsStore', () => {
  beforeEach(async () => {
    resetRecentLyricsStore()
    await clearRecentSharedLyrics()
  })

  const samplePayload1: SharedLyricsPayload = {
    v: 1,
    name: 'Sunday Morning',
    songs: [
      {
        entryId: 'e1',
        title: 'Amazing Grace',
        sections: [{ label: 'Verse 1', lines: ['Line 1'] }],
      },
    ],
  }

  const samplePayload2: SharedLyricsPayload = {
    v: 1,
    name: 'Youth Night',
    songs: [
      {
        entryId: 'e2',
        title: 'Cornerstone',
        sections: [{ label: 'Chorus', lines: ['Christ alone'] }],
      },
    ],
  }

  it('saves and retrieves recently opened shared lyrics', async () => {
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-22T00:00:00Z')
    const list = await getRecentSharedLyrics()

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('link-1')
    expect(list[0].name).toBe('Sunday Morning')
    expect(list[0].songCount).toBe(1)
    expect(list[0].expiresAt).toBe('2026-10-22T00:00:00Z')
    expect(list[0].songs).toEqual(samplePayload1.songs)
  })

  it('orders most recently opened sets first', async () => {
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-22T00:00:00Z')
    // small delay
    await new Promise((r) => setTimeout(r, 10))
    await saveRecentSharedLyrics('link-2', samplePayload2, '2026-10-22T00:00:00Z')

    const list = await getRecentSharedLyrics()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('link-2')
    expect(list[1].id).toBe('link-1')
  })

  it('deduplicates and bumps existing link when re-opened', async () => {
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-22T00:00:00Z')
    await saveRecentSharedLyrics('link-2', samplePayload2, '2026-10-22T00:00:00Z')
    await new Promise((r) => setTimeout(r, 10))
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-23T00:00:00Z')

    const list = await getRecentSharedLyrics()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('link-1')
    expect(list[0].expiresAt).toBe('2026-10-23T00:00:00Z')
    expect(list[1].id).toBe('link-2')
  })

  it('gets cached shared lyrics by shortId', async () => {
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-22T00:00:00Z')
    const item = await getCachedSharedLyrics('link-1')
    expect(item).toBeDefined()
    expect(item?.name).toBe('Sunday Morning')

    const nonExistent = await getCachedSharedLyrics('does-not-exist')
    expect(nonExistent).toBeUndefined()
  })

  it('removes a specific shared lyrics entry', async () => {
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-22T00:00:00Z')
    await saveRecentSharedLyrics('link-2', samplePayload2, '2026-10-22T00:00:00Z')

    await removeRecentSharedLyrics('link-1')
    const list = await getRecentSharedLyrics()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('link-2')
  })

  it('clears all recent shared lyrics', async () => {
    await saveRecentSharedLyrics('link-1', samplePayload1, '2026-10-22T00:00:00Z')
    await clearRecentSharedLyrics()
    const list = await getRecentSharedLyrics()
    expect(list).toHaveLength(0)
  })
})
