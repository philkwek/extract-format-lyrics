import { describe, expect, it } from 'vitest'
import { isExpired, isSharedSetSnapshot, MAX_SHARED_SET_SONGS } from './shareStore.js'

const snapshot = {
  v: 2,
  name: 'Sunday',
  songs: [{
    entryId: 'entry-1',
    song: { id: 'song-1', sourceUrl: 'https://example.test/song', sections: [] },
  }],
}

describe('shared set validation', () => {
  it('accepts a versioned snapshot with complete song identity', () => {
    expect(isSharedSetSnapshot(snapshot)).toBe(true)
  })

  it('rejects snapshots above the hard share limit', () => {
    expect(isSharedSetSnapshot({ ...snapshot, songs: Array.from({ length: MAX_SHARED_SET_SONGS + 1 }, () => snapshot.songs[0]) })).toBe(false)
  })

  it('treats the exact expiry instant as expired', () => {
    const now = new Date('2026-10-11T00:00:00.000Z')
    expect(isExpired(new Date(now), now)).toBe(true)
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false)
  })
})
