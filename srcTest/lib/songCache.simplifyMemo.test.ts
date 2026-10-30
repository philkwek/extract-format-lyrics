import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SongCache, type StorageStore } from '../../src/lib/songCache'
import { simplifySections } from '../../src/lib/chords'
import type { Section, Song } from '../../src/types/song'

vi.mock('../../src/lib/chords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/chords')>()
  return {
    ...actual,
    simplifySections: vi.fn((sections: Section[]) => ({ sections, changedCount: 0 })),
  }
})

function createStore(): StorageStore {
  const memory = new Map<string, unknown>()
  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => memory.get(key) as T | undefined),
    set: vi.fn(async (key: string, val: unknown): Promise<void> => {
      memory.set(key, val)
    }),
    del: vi.fn(async (key: string): Promise<void> => {
      memory.delete(key)
    }),
    entries: vi.fn(
      async <T>(): Promise<[IDBValidKey, T][]> =>
        Array.from(memory.entries()) as [IDBValidKey, T][],
    ),
  } as unknown as StorageStore
}

const song: Song = {
  id: 'plain-song',
  title: 'Plain Song',
  artist: 'Artist',
  sourceUrl: 'https://tabs.ultimate-guitar.com/tab/plain',
  sourceSite: 'ultimate-guitar',
  originalKey: 'G',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'Hello world', chords: [{ chord: 'G', pos: 0 }] }],
    },
  ],
}

describe('SongCache simplification memo', () => {
  beforeEach(() => {
    vi.mocked(simplifySections).mockClear()
  })

  it('does not re-simplify a song that has nothing to simplify', async () => {
    const cache = new SongCache(createStore())
    await cache.saveSong(song)

    await cache.getSong(song.sourceUrl)
    await cache.getSong(song.sourceUrl)

    expect(simplifySections).toHaveBeenCalledTimes(1)
  })

  it('checks a song again after it is re-saved', async () => {
    const cache = new SongCache(createStore())
    await cache.saveSong(song)
    await cache.getSong(song.sourceUrl)

    await cache.saveSong(song)
    await cache.getSong(song.sourceUrl)

    expect(simplifySections).toHaveBeenCalledTimes(2)
  })

  it('checks a song again when re-saved and read through its original URL alias', async () => {
    const cache = new SongCache(createStore())
    const requested = 'https://tabs.ultimate-guitar.com/tab/requested'
    await cache.saveSong(song, requested)
    await cache.getSong(requested)

    await cache.saveSong(song, requested)
    await cache.getSong(requested)

    expect(simplifySections).toHaveBeenCalledTimes(2)
  })
})
