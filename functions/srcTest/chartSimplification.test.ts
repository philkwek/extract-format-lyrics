import { describe, expect, it, vi } from 'vitest'
import {
  SimplificationCache,
  loadOfficialSimplification,
  type SimplificationCacheStore,
} from '../src/chartSimplification.js'
import {
  ChartCache,
  type ChartAliasEntry,
  type ChartCacheEntry,
  type ChartCacheStore,
} from '../src/chartCache.js'
import { FetchError } from '../src/safeFetch.js'

function ugHtml(content: string): string {
  const data = {
    store: {
      page: {
        data: {
          tab: { song_name: 'Song', artist_name: 'Artist' },
          tab_view: {
            meta: { tonality: 'G' },
            is_simplify_available: true,
            wiki_tab: { content },
          },
        },
      },
    },
  }
  return `<div class="js-store" data-content="${JSON.stringify(data).replace(/"/g, '&quot;')}"></div>`
}

function emptyCacheStore() {
  const entries = new Map<string, Parameters<SimplificationCacheStore['set']>[1]>()
  const store: SimplificationCacheStore = {
    get: vi.fn(async (key: string) => entries.get(key) ?? null),
    set: vi.fn(async (key: string, entry: Parameters<SimplificationCacheStore['set']>[1]) => {
      entries.set(key, entry)
    }),
  }
  return { store, entries }
}

function emptyChartStore() {
  const charts = new Map<string, ChartCacheEntry>()
  const aliases = new Map<string, ChartAliasEntry>()
  const store: ChartCacheStore = {
    getChart: vi.fn(async (key: string) => charts.get(key) ?? null),
    setChart: vi.fn(async (key: string, entry: ChartCacheEntry) => {
      charts.set(key, entry)
    }),
    getAlias: vi.fn(async (key: string) => aliases.get(key) ?? null),
    setAlias: vi.fn(async (key: string, entry: ChartAliasEntry) => {
      aliases.set(key, entry)
    }),
  }
  return store
}

const url = 'https://tabs.ultimate-guitar.com/tab/song-123'

describe('SimplificationCache', () => {
  it('expires successful and unavailable entries explicitly', async () => {
    const { store } = emptyCacheStore()
    let now = 1_000
    const cache = new SimplificationCache({
      store,
      now: () => now,
      ttlMs: 100,
      unavailableTtlMs: 20,
    })

    await cache.set(url, {
      status: 'ok',
      simplifiedSections: [],
      simplifiedSource: 'official',
    })
    expect(await cache.get(url)).toMatchObject({ status: 'ok' })
    now = 1_101
    expect(await cache.get(url)).toBeNull()

    await cache.set(url, { status: 'unavailable' })
    now = 1_122
    expect(await cache.get(url)).toBeNull()
  })

  it('ignores entries from an older version', async () => {
    const { store, entries } = emptyCacheStore()
    entries.set('unused', {
      v: 1,
      parserVersion: 'simplification-v1',
      canonicalUrl: url,
      status: 'ok',
      simplifiedSections: [],
      expiresAt: 10_000,
    })
    const cache = new SimplificationCache({
      store,
      version: 'simplification-v2',
      now: () => 1_000,
    })
    await cache.set(url, { status: 'ok', simplifiedSections: [], simplifiedSource: 'official' })
    expect(store.set).toHaveBeenCalledTimes(1)
  })
})

describe('loadOfficialSimplification', () => {
  it('coalesces identical requests and caches the official chart', async () => {
    const { store } = emptyCacheStore()
    const cache = new SimplificationCache({ store, now: () => 1_000 })
    const sourceCache = new ChartCache({ store: emptyChartStore(), now: () => 1_000 })
    let resolveFetch!: (value: { text: string; finalUrl: string }) => void
    const fetchFn = vi.fn(
      () =>
        new Promise<{ text: string; finalUrl: string }>((resolve) => {
          resolveFetch = resolve
        })
    )

    const first = loadOfficialSimplification(url, { cache, sourceCache, fetchFn })
    const second = loadOfficialSimplification(url, { cache, sourceCache, fetchFn })
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    resolveFetch({ text: ugHtml('[Verse]\nG  C\nSimplified line'), finalUrl: `${url}?simplified=1` })

    const [a, b] = await Promise.all([first, second])
    expect(a).toMatchObject({ status: 'ok', simplifiedSource: 'official' })
    expect(b).toMatchObject({ status: 'ok' })

    const cached = await loadOfficialSimplification(url, { cache, sourceCache, fetchFn })
    expect(cached).toMatchObject({ status: 'ok', cached: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('caches a failed enrichment briefly without breaking the original chart', async () => {
    const { store } = emptyCacheStore()
    const cache = new SimplificationCache({ store, now: () => 1_000 })
    const sourceCache = new ChartCache({ store: emptyChartStore(), now: () => 1_000 })
    const fetchFn = vi.fn(async () => {
      throw new FetchError('timed out', 'TIMEOUT')
    })

    const result = await loadOfficialSimplification(url, { cache, sourceCache, fetchFn })
    expect(result).toMatchObject({ status: 'unavailable', code: 'TIMEOUT' })
    const cached = await loadOfficialSimplification(url, { cache, sourceCache, fetchFn })
    expect(cached).toMatchObject({ status: 'unavailable', cached: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not fetch for sources without official simplification', async () => {
    const fetchFn = vi.fn()
    const result = await loadOfficialSimplification('https://pnwchords.com/song', {
      cache: new SimplificationCache({ store: emptyCacheStore().store }),
      sourceCache: new ChartCache({ store: emptyChartStore() }),
      fetchFn: fetchFn as never,
    })
    expect(result).toMatchObject({ status: 'unavailable', code: 'UNSUPPORTED_SOURCE' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
