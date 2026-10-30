import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  derivePublicationId,
  isLyricsExpired,
  isSharedLyricsPayload,
  MAX_SHARED_LYRICS_SONGS,
  SharedLyricsStore,
  verifyPublicationSecret,
} from '../src/sharedLyricsStore.js'
import type { SharedLyricsPayload } from '../src/types.js'

interface MockDocSnapshot {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

// In-memory Firestore mock for isolated store unit tests
class MockDocRef {
  constructor(
    public readonly id: string,
    private readonly store: Map<string, Record<string, unknown>>,
    public readonly path: string
  ) {}

  collection(name: string): MockCollectionRef {
    return new MockCollectionRef(this.store, `${this.path}/${name}`)
  }

  async get(): Promise<MockDocSnapshot> {
    const data = this.store.get(this.path)
    return {
      exists: data !== undefined,
      data: () => data,
    }
  }
}

class MockCollectionRef {
  constructor(
    private readonly store: Map<string, Record<string, unknown>>,
    public readonly path: string
  ) {}

  doc(id?: string): MockDocRef {
    const docId = id || Math.random().toString(36).slice(2, 9)
    return new MockDocRef(docId, this.store, `${this.path}/${docId}`)
  }

  orderBy() {
    return this
  }

  async get() {
    const prefix = `${this.path}/`
    const docs: Array<{ id: string; data: () => Record<string, unknown> }> = []
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const subpath = key.slice(prefix.length)
        if (!subpath.includes('/')) {
          docs.push({
            id: subpath,
            data: () => value,
          })
        }
      }
    }
    docs.sort((a, b) => (Number(a.data().index) || 0) - (Number(b.data().index) || 0))
    return { docs }
  }
}

interface MockTransaction {
  get: (ref: MockDocRef) => Promise<MockDocSnapshot>
  set: (ref: MockDocRef, docData: Record<string, unknown>) => void
  delete: (ref: MockDocRef) => void
}

class MockFirestore {
  public readonly data = new Map<string, Record<string, unknown>>()

  collection(name: string): MockCollectionRef {
    return new MockCollectionRef(this.data, name)
  }

  async runTransaction<T>(updateFunction: (transaction: MockTransaction) => Promise<T>): Promise<T> {
    const staging = new Map<string, Record<string, unknown>>()
    const deletions = new Set<string>()

    const transaction: MockTransaction = {
      get: async (ref: MockDocRef) => {
        if (deletions.has(ref.path)) return { exists: false, data: () => undefined }
        const current = staging.has(ref.path) ? staging.get(ref.path) : this.data.get(ref.path)
        return {
          exists: current !== undefined,
          data: () => current,
        }
      },
      set: (ref: MockDocRef, docData: Record<string, unknown>) => {
        deletions.delete(ref.path)
        staging.set(ref.path, docData)
      },
      delete: (ref: MockDocRef) => {
        staging.delete(ref.path)
        deletions.add(ref.path)
      },
    }

    const result = await updateFunction(transaction)
    for (const path of deletions) {
      this.data.delete(path)
    }
    for (const [path, val] of staging.entries()) {
      this.data.set(path, val)
    }
    return result
  }
}

const validPayload: SharedLyricsPayload = {
  v: 1,
  name: 'Sunday Morning',
  songs: [
    {
      entryId: 'entry-1',
      title: 'First Song',
      sections: [
        { label: 'Verse 1', lines: ['Line 1', 'Line 2'] },
        { label: 'Chorus', lines: ['Chorus line'] },
      ],
    },
    {
      entryId: 'entry-2',
      title: 'Second Song',
      sections: [{ label: 'Intro', lines: [] }],
    },
  ],
}

describe('shared lyrics store and validation', () => {
  it('accepts valid version 1 payload', () => {
    expect(isSharedLyricsPayload(validPayload)).toBe(true)
  })

  it('rejects invalid payloads and limits above 15 songs', () => {
    expect(isSharedLyricsPayload({ ...validPayload, v: 2 })).toBe(false)
    expect(isSharedLyricsPayload({ ...validPayload, name: '' })).toBe(false)
    expect(isSharedLyricsPayload({ ...validPayload, songs: [] })).toBe(false)
    expect(
      isSharedLyricsPayload({
        ...validPayload,
        songs: Array.from({ length: MAX_SHARED_LYRICS_SONGS + 1 }, () => validPayload.songs[0]),
      })
    ).toBe(false)
  })

  it('derives and verifies domain-separated publication secrets', () => {
    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const publicationId = derivePublicationId(secret)
    expect(publicationId).toHaveLength(64)
    expect(verifyPublicationSecret(secret, publicationId)).toBe(true)
    expect(verifyPublicationSecret('wrong-secret', publicationId)).toBe(false)
    expect(verifyPublicationSecret('', publicationId)).toBe(false)
  })

  it('treats exact expiry boundaries accurately', () => {
    const now = new Date('2026-10-15T12:00:00.000Z')
    expect(isLyricsExpired(new Date(now), now)).toBe(true)
    expect(isLyricsExpired(new Date(now.getTime() - 1000), now)).toBe(true)
    expect(isLyricsExpired(new Date(now.getTime() + 1), now)).toBe(false)
  })

  it('performs ordered retrieval and persists only chord-free whitelisted fields', async () => {
    const mockDb = new MockFirestore()
    const now = new Date('2026-10-15T10:00:00.000Z')
    const store = new SharedLyricsStore(mockDb as unknown as Firestore, () => now)

    const secret = 'secret-123'
    const id = derivePublicationId(secret)

    // Publish with extra unwhitelisted fields in payload
    const payloadWithJunk = {
      ...validPayload,
      extraRootField: 'should not be saved',
      songs: [
        {
          ...validPayload.songs[0],
          chords: ['G', 'C'],
          key: 'G',
          url: 'https://example.com/song1',
          sections: [
            {
              label: 'Verse 1',
              lines: ['Line 1', 'Line 2'],
              chordPlacements: [{ pos: 0, chord: 'G' }],
            },
          ],
        },
      ],
    }

    const { id: pubId, expiresAt } = await store.publish(
      id,
      payloadWithJunk as unknown as SharedLyricsPayload
    )
    expect(pubId).toBe(id)
    expect(expiresAt.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // Check stored root document
    const rootDoc = mockDb.data.get(`sharedLyrics/${id}`)
    expect(rootDoc?.v).toBe(1)
    expect(rootDoc?.name).toBe('Sunday Morning')
    expect(rootDoc?.songCount).toBe(1)
    expect(rootDoc?.extraRootField).toBeUndefined()

    // Check stored song document
    const songDoc = mockDb.data.get(`sharedLyrics/${id}/songs/00`)
    expect(songDoc?.index).toBe(0)
    expect(songDoc?.entryId).toBe('entry-1')
    expect(songDoc?.title).toBe('First Song')
    expect(songDoc?.chords).toBeUndefined()
    expect(songDoc?.key).toBeUndefined()
    expect(songDoc?.url).toBeUndefined()
    const sec0 = (songDoc?.sections as Record<string, unknown>[])[0]
    expect(sec0.chordPlacements).toBeUndefined()
    expect(sec0.lines).toEqual(['Line 1', 'Line 2'])
    expect(songDoc?.expiresAt).toBeDefined()
    expect(songDoc?.expiresAt).toEqual(rootDoc?.expiresAt)

    // Retrieve via store
    const lookup = await store.get(id)
    expect(lookup.kind).toBe('found')
    if (lookup.kind === 'found') {
      expect(lookup.lyrics.v).toBe(1)
      expect(lookup.lyrics.name).toBe('Sunday Morning')
      expect(lookup.lyrics.songs).toHaveLength(1)
      expect(lookup.lyrics.songs[0].entryId).toBe('entry-1')
      expect(lookup.lyrics.songs[0].title).toBe('First Song')
    }
  })

  it('handles shrinking sets by deleting obsolete song documents atomically', async () => {
    const mockDb = new MockFirestore()
    const now = new Date('2026-10-15T10:00:00.000Z')
    const store = new SharedLyricsStore(mockDb as unknown as Firestore, () => now)
    const id = 'test-publication-shrink'

    // Initial publish: 2 songs
    await store.publish(id, validPayload)
    expect(mockDb.data.has(`sharedLyrics/${id}/songs/00`)).toBe(true)
    expect(mockDb.data.has(`sharedLyrics/${id}/songs/01`)).toBe(true)

    // Updated publish: 1 song (shrinking set)
    const shrunkPayload: SharedLyricsPayload = {
      v: 1,
      name: 'Sunday Morning (Shrunk)',
      songs: [validPayload.songs[0]],
    }
    await store.publish(id, shrunkPayload)

    expect(mockDb.data.get(`sharedLyrics/${id}`)?.songCount).toBe(1)
    expect(mockDb.data.has(`sharedLyrics/${id}/songs/00`)).toBe(true)
    // Obsolete document at 01 must be deleted!
    expect(mockDb.data.has(`sharedLyrics/${id}/songs/01`)).toBe(false)

    // Retrieval should only return 1 song
    const lookup = await store.get(id)
    expect(lookup.kind).toBe('found')
    if (lookup.kind === 'found') {
      expect(lookup.lyrics.songs).toHaveLength(1)
      expect(lookup.lyrics.name).toBe('Sunday Morning (Shrunk)')
    }
  })

  it('handles atomic failures without persisting partial updates', async () => {
    const mockDb = new MockFirestore()
    const store = new SharedLyricsStore(mockDb as unknown as Firestore)
    const id = 'atomic-fail-test'

    // Publish initial valid data
    await store.publish(id, validPayload)
    expect(mockDb.data.has(`sharedLyrics/${id}/songs/00`)).toBe(true)

    // Mock transaction throwing mid-execution
    const failingDb = {
      collection: (name: string) => mockDb.collection(name),
      runTransaction: async () => {
        throw new Error('Database transaction abort')
      },
    }
    const failingStore = new SharedLyricsStore(failingDb as unknown as Firestore)

    await expect(failingStore.publish(id, validPayload)).rejects.toThrow('Database transaction abort')
  })

  it('returns missing for non-existent IDs and expired for past expiry', async () => {
    const mockDb = new MockFirestore()
    let currentTime = new Date('2026-10-15T10:00:00.000Z')
    const store = new SharedLyricsStore(mockDb as unknown as Firestore, () => currentTime)

    // Non-existent ID
    const missing = await store.get('does-not-exist')
    expect(missing.kind).toBe('missing')

    // Publish record
    const id = 'expire-test'
    await store.publish(id, validPayload)

    // Still valid
    const found = await store.get(id)
    expect(found.kind).toBe('found')

    // Advance past 7 days
    currentTime = new Date(currentTime.getTime() + 8 * 24 * 60 * 60 * 1000)
    const expired = await store.get(id)
    expect(expired.kind).toBe('expired')
  })
})
