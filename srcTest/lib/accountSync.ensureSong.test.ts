import { describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  db: {},
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  query: vi.fn((target: unknown, ...constraints: unknown[]) => ({ target, constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, dir: string) => ({ field, dir })),
  Timestamp: { fromMillis: vi.fn((ms: number) => ({ ms })) },
  getDoc: vi.fn(),
  getDocsFromServer: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
}))

vi.mock('../../src/lib/firestoreClient', () => ({
  loadFirestore: vi.fn(async () => fsMock),
}))

import { AccountOfflineError, createFirestoreAdapter } from '../../src/lib/accountSync'
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

describe('createFirestoreAdapter().listDeletedSets', () => {
  it('reads from the server and maps returned documents', async () => {
    fsMock.getDocsFromServer.mockResolvedValueOnce({
      docs: [
        {
          id: 'set-1',
          data: () => ({
            rev: 2,
            data: '{}',
            songCount: 1,
            updatedAt: 1000,
            deletedAt: { toMillis: () => 2000 },
          }),
        },
      ],
    })

    const adapter = createFirestoreAdapter()
    const rows = await adapter.listDeletedSets('uid-1', 500)

    expect(fsMock.getDocsFromServer).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([
      {
        setId: 'set-1',
        snapshot: { rev: 2, data: '{}', songCount: 1, updatedAt: 1000, deletedAt: 2000 },
      },
    ])
  })

  it('converts unavailable into AccountOfflineError', async () => {
    fsMock.getDocsFromServer.mockRejectedValueOnce({ code: 'unavailable' })

    const adapter = createFirestoreAdapter()
    await expect(adapter.listDeletedSets('uid-1', 500)).rejects.toBeInstanceOf(AccountOfflineError)
  })
})
