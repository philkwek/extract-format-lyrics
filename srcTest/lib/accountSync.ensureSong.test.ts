import { describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  db: {},
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
}))

vi.mock('../../src/lib/firestoreClient', () => ({
  loadFirestore: vi.fn(async () => fsMock),
}))

import { createFirestoreAdapter } from '../../src/lib/accountSync'
import type { Song } from '../../src/types/song'

const demoSong: Song = {
  id: 'song-1',
  title: 'Demo Song',
  artist: 'Demo Artist',
  sourceUrl: 'https://example.test/demo',
  sourceSite: 'Demo',
  originalKey: 'C',
  sections: [],
}

describe('createFirestoreAdapter().ensureSong', () => {
  it('ignores permission-denied when the song document already exists', async () => {
    fsMock.getDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => true })
    fsMock.setDoc.mockRejectedValueOnce({ code: 'permission-denied' })

    const adapter = createFirestoreAdapter()
    await expect(adapter.ensureSong('uid-1', 'hash-1', demoSong)).resolves.toBeUndefined()
  })

  it('rethrows permission-denied when the song document does not exist', async () => {
    fsMock.getDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false })
    fsMock.setDoc.mockRejectedValueOnce({ code: 'permission-denied' })

    const adapter = createFirestoreAdapter()
    await expect(adapter.ensureSong('uid-1', 'hash-1', demoSong)).rejects.toEqual({
      code: 'permission-denied',
    })
  })
})
