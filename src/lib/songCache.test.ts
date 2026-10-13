import { describe, it, expect, vi } from 'vitest'
import { SongCache, normalizeSongUrl, type StorageStore } from './songCache'
import type { Song } from '../types/song'

describe('normalizeSongUrl', () => {
  it('strips tracking params and fragment', () => {
    const url = 'https://tabs.ultimate-guitar.com/song?utm_source=twitter&utm_medium=social#verse-1'
    expect(normalizeSongUrl(url)).toBe('https://tabs.ultimate-guitar.com/song')
  })
})

describe('SongCache', () => {
  const sampleSong: Song = {
    id: 'song1',
    title: 'Amazing Grace',
    artist: 'John Newton',
    sourceUrl: 'https://pnwchords.com/amazing-grace',
    sourceSite: 'pnwchords',
    originalKey: 'G',
    sections: [],
  }

  it('persists and retrieves song via fake store', async () => {
    const memory = new Map<string, unknown>()
    const fakeStore = {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => memory.get(key) as T | undefined),
      set: vi.fn(async (key: string, val: unknown): Promise<void> => {
        memory.set(key, val)
      }),
      del: vi.fn(async (key: string): Promise<void> => {
        memory.delete(key)
      }),
      entries: vi.fn(async <T>(): Promise<[IDBValidKey, T][]> => Array.from(memory.entries()) as [IDBValidKey, T][]),
    }

    const cache = new SongCache(fakeStore as unknown as StorageStore)

    expect(await cache.getSong(sampleSong.sourceUrl)).toBeNull()

    await cache.saveSong(sampleSong)
    const retrieved = await cache.getSong(sampleSong.sourceUrl)
    expect(retrieved?.title).toBe('Amazing Grace')

    await cache.removeSong(sampleSong.sourceUrl)
    expect(await cache.getSong(sampleSong.sourceUrl)).toBeNull()
  })

  it('enriches older website songs without simplifiedSections on read and persists to store', async () => {
    const memory = new Map<string, unknown>()
    const fakeStore = {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => memory.get(key) as T | undefined),
      set: vi.fn(async (key: string, val: unknown): Promise<void> => {
        memory.set(key, val)
      }),
      del: vi.fn(async (key: string): Promise<void> => {
        memory.delete(key)
      }),
      entries: vi.fn(async <T>(): Promise<[IDBValidKey, T][]> => Array.from(memory.entries()) as [IDBValidKey, T][]),
    }

    const cache = new SongCache(fakeStore as unknown as StorageStore)
    const oldSong: Song = {
      id: 'old-website-song',
      title: 'Complex Song',
      artist: 'Artist',
      sourceUrl: 'https://tabs.ultimate-guitar.com/tab/123',
      sourceSite: 'ultimate-guitar',
      originalKey: 'G',
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: 'Hello world',
              chords: [{ chord: 'Gmaj7', pos: 0 }, { chord: 'D/F#', pos: 6 }],
            },
          ],
        },
      ],
    }

    await cache.saveSong(oldSong)
    const setCallsBefore = fakeStore.set.mock.calls.length

    const retrieved = await cache.getSong(oldSong.sourceUrl)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.simplifiedSource).toBe('algorithmic')
    expect(retrieved?.simplifiedSections).toBeDefined()
    expect(retrieved?.simplifiedSections?.[0].lines[0]).toEqual({
      kind: 'lyric',
      text: 'Hello world',
      chords: [
        { chord: 'G', pos: 0 },
        { chord: 'D', pos: 6 },
      ],
    })
    // Original sections must remain untouched
    expect(retrieved?.sections[0].lines[0]).toEqual({
      kind: 'lyric',
      text: 'Hello world',
      chords: [
        { chord: 'Gmaj7', pos: 0 },
        { chord: 'D/F#', pos: 6 },
      ],
    })
    // Must have persisted the enriched song back to store
    expect(fakeStore.set.mock.calls.length).toBeGreaterThan(setCallsBefore)
  })

  it('does not enrich songs when already simple', async () => {
    const memory = new Map<string, unknown>()
    const fakeStore = {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => memory.get(key) as T | undefined),
      set: vi.fn(async (key: string, val: unknown): Promise<void> => {
        memory.set(key, val)
      }),
      del: vi.fn(async (key: string): Promise<void> => {
        memory.delete(key)
      }),
      entries: vi.fn(async <T>(): Promise<[IDBValidKey, T][]> => Array.from(memory.entries()) as [IDBValidKey, T][]),
    }

    const cache = new SongCache(fakeStore as unknown as StorageStore)
    const simpleSong: Song = {
      id: 'simple-song',
      title: 'Simple Song',
      artist: 'Artist',
      sourceUrl: 'https://tabs.ultimate-guitar.com/tab/simple',
      sourceSite: 'ultimate-guitar',
      originalKey: 'G',
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: 'Hello world',
              chords: [{ chord: 'G', pos: 0 }, { chord: 'D', pos: 6 }],
            },
          ],
        },
      ],
    }

    await cache.saveSong(simpleSong)
    fakeStore.set.mockClear()

    const retrieved = await cache.getSong(simpleSong.sourceUrl)
    expect(retrieved?.simplifiedSections).toBeUndefined()
    expect(retrieved?.simplifiedSource).toBeUndefined()
    // Should not have persisted anything back since nothing changed
    expect(fakeStore.set).not.toHaveBeenCalled()
  })

  it('does not enrich uploaded songs (upload://)', async () => {
    const memory = new Map<string, unknown>()
    const fakeStore = {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => memory.get(key) as T | undefined),
      set: vi.fn(async (key: string, val: unknown): Promise<void> => {
        memory.set(key, val)
      }),
      del: vi.fn(async (key: string): Promise<void> => {
        memory.delete(key)
      }),
      entries: vi.fn(async <T>(): Promise<[IDBValidKey, T][]> => Array.from(memory.entries()) as [IDBValidKey, T][]),
    }

    const cache = new SongCache(fakeStore as unknown as StorageStore)
    const uploadedSong: Song = {
      id: 'uploaded-song',
      title: 'Uploaded Sheet',
      artist: 'Artist',
      sourceUrl: 'upload://sheet-123.pdf',
      sourceSite: 'upload',
      originalKey: 'G',
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: 'Hello world',
              chords: [{ chord: 'Gmaj7', pos: 0 }],
            },
          ],
        },
      ],
    }

    await cache.saveSong(uploadedSong)
    fakeStore.set.mockClear()

    const retrieved = await cache.getSong(uploadedSong.sourceUrl)
    expect(retrieved?.simplifiedSections).toBeUndefined()
    expect(retrieved?.simplifiedSource).toBeUndefined()
    expect(fakeStore.set).not.toHaveBeenCalled()
  })

  it('preserves existing simplified sections and does not overwrite with algorithmic', async () => {
    const memory = new Map<string, unknown>()
    const fakeStore = {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => memory.get(key) as T | undefined),
      set: vi.fn(async (key: string, val: unknown): Promise<void> => {
        memory.set(key, val)
      }),
      del: vi.fn(async (key: string): Promise<void> => {
        memory.delete(key)
      }),
      entries: vi.fn(async <T>(): Promise<[IDBValidKey, T][]> => Array.from(memory.entries()) as [IDBValidKey, T][]),
    }

    const cache = new SongCache(fakeStore as unknown as StorageStore)
    const existingSimplifiedSong: Song = {
      id: 'official-simplified-song',
      title: 'Song With Official Simplification',
      artist: 'Artist',
      sourceUrl: 'https://tabs.ultimate-guitar.com/tab/official',
      sourceSite: 'ultimate-guitar',
      originalKey: 'G',
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: 'Hello world',
              chords: [{ chord: 'Gmaj7', pos: 0 }],
            },
          ],
        },
      ],
      simplifiedSections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              text: 'Hello world',
              chords: [{ chord: 'G', pos: 0 }],
            },
          ],
        },
      ],
      simplifiedSource: 'official',
    }

    await cache.saveSong(existingSimplifiedSong)
    fakeStore.set.mockClear()

    const retrieved = await cache.getSong(existingSimplifiedSong.sourceUrl)
    expect(retrieved?.simplifiedSource).toBe('official')
    expect(fakeStore.set).not.toHaveBeenCalled()
  })
})

