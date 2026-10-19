import { describe, expect, it, vi } from 'vitest'
import {
  SearchCache,
  SEARCH_CACHE_VERSION,
  createSearchCacheKey,
  isCachedSearchEntry,
  normalizeSearchQuery,
  type CachedSearchEntry,
  type SearchCacheStore,
  type SearchResponseData,
} from '../../src/search/searchCache.js'

function data(partial = false): SearchResponseData {
  return {
    results: [
      {
        site: 'pnwchords',
        title: 'Good Grace',
        artist: 'Hillsong Worship',
        url: 'https://pnwchords.com/good-grace',
      },
    ],
    sources: [{ site: 'pnwchords', status: 'ok', count: 1, durationMs: 1 }],
    partial,
  }
}

function memoryStore() {
  const entries = new Map<string, CachedSearchEntry>()
  const store: SearchCacheStore = {
    get: vi.fn(async (key: string) => entries.get(key) ?? null),
    set: vi.fn(async (key: string, entry: CachedSearchEntry) => {
      entries.set(key, entry)
    }),
  }
  return { store, entries }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('search cache keys', () => {
  it('normalises case and whitespace for lookup only', () => {
    expect(normalizeSearchQuery('  Good   GRACE ')).toBe('good grace')
    expect(createSearchCacheKey('  Good   GRACE ')).toBe(`${SEARCH_CACHE_VERSION}:good grace`)
  })

  it('changes the key when the cache version changes', () => {
    expect(createSearchCacheKey('song', 'v1')).not.toBe(createSearchCacheKey('song', 'v2'))
  })

  it('rejects expired or malformed entries', () => {
    expect(isCachedSearchEntry({ ...data(), v: 1, expiresAt: 10 }, 11)).toBe(false)
    expect(isCachedSearchEntry({ ...data(), v: 1, expiresAt: 20 }, 11)).toBe(true)
    expect(isCachedSearchEntry({ v: 1, expiresAt: 20 }, 11)).toBe(false)
  })
})

describe('SearchCache', () => {
  it('caches complete results and reuses them inside the TTL', async () => {
    const { store } = memoryStore()
    const cache = new SearchCache({ store, now: () => 1_000, completeTtlMs: 5_000 })
    const run = vi.fn(async () => data())

    const first = await cache.search('Good Grace', run)
    const second = await cache.search('  good   grace ', run)

    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('hit')
    expect(run).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledTimes(1)
  })

  it('expires entries explicitly', async () => {
    const { store } = memoryStore()
    let now = 1_000
    const cache = new SearchCache({ store, now: () => now, completeTtlMs: 100 })
    const run = vi.fn(async () => data())

    await cache.search('song', run)
    now = 1_101
    await cache.search('song', run)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('shares identical concurrent work and removes it afterwards', async () => {
    const { store } = memoryStore()
    const cache = new SearchCache({ store, now: () => 1_000 })
    const pending = deferred<SearchResponseData>()
    const run = vi.fn(() => pending.promise)

    const first = cache.search('song', run)
    const second = cache.search('song', run)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))

    pending.resolve(data())
    await expect(first).resolves.toMatchObject({ cacheStatus: 'miss' })
    await expect(second).resolves.toMatchObject({ cacheStatus: 'miss' })

    const later = await cache.search('song', vi.fn(async () => data()))
    expect(later.cacheStatus).toBe('hit')
  })

  it('removes failed in-flight promises so a retry can run', async () => {
    const { store } = memoryStore()
    const cache = new SearchCache({ store, now: () => 1_000 })
    const run = vi
      .fn<() => Promise<SearchResponseData>>()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(data())

    await expect(cache.search('song', run)).rejects.toThrow('upstream down')
    await expect(cache.search('song', run)).resolves.toMatchObject({ data: data() })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('keeps partial or failed-site results only in memory with a short expiry', async () => {
    const { store } = memoryStore()
    let now = 1_000
    const cache = new SearchCache({
      store,
      now: () => now,
      completeTtlMs: 5_000,
      partialTtlMs: 30,
    })
    const run = vi.fn(async () => data(true))

    await cache.search('song', run)
    expect(store.set).not.toHaveBeenCalled()
    await cache.search('song', run)
    expect(run).toHaveBeenCalledTimes(1)

    now = 1_031
    await cache.search('song', run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('treats persistent cache failures as misses without breaking search', async () => {
    const failingStore: SearchCacheStore = {
      get: vi.fn(async () => {
        throw new Error('firestore unavailable')
      }),
      set: vi.fn(async () => {
        throw new Error('firestore unavailable')
      }),
    }
    const cache = new SearchCache({ store: failingStore, now: () => 1_000 })
    const run = vi.fn(async () => data())

    await expect(cache.search('song', run)).resolves.toMatchObject({ cacheStatus: 'miss' })
    await expect(cache.search('other', run)).resolves.toMatchObject({ cacheStatus: 'miss' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('bounds memory and evicts the oldest entry', async () => {
    const store: SearchCacheStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    }
    const cache = new SearchCache({ store, now: () => 1_000, maxEntries: 2 })
    const run = vi.fn(async () => data())
    await cache.search('one', run)
    await cache.search('two', run)
    await cache.search('three', run)
    await cache.search('one', run)
    expect(run).toHaveBeenCalledTimes(4)
  })
})
