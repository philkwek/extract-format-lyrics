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
})
