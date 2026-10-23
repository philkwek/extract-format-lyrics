import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ChartCache,
  canonicalChartUrl,
  toSourceSong,
  type ChartAliasEntry,
  type ChartCacheEntry,
  type ChartCacheStore,
} from '../src/chartCache.js'
import { loadSourceChart } from '../src/chartLoader.js'
import type { Song } from '../src/types.js'

function song(sourceUrl = 'https://pnwchords.com/good-grace'): Song {
  return {
    id: 'song-1',
    title: 'Good Grace',
    artist: 'Hillsong Worship',
    sourceUrl,
    sourceSite: 'pnwchords',
    originalKey: 'G',
    capo: 2,
    sections: [{ type: 'Verse', label: 'Verse 1', lines: [] }],
  }
}

function memoryStore() {
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
  return { store, charts, aliases }
}

describe('canonicalChartUrl', () => {
  it('keeps version and simplification parameters but drops tracking', () => {
    expect(
      canonicalChartUrl(
        'https://TABS.ultimate-guitar.com/tab/song?simplified=1&utm_source=x&version=2#top'
      )
    ).toBe('https://tabs.ultimate-guitar.com/tab/song?simplified=1&version=2')
  })
})

describe('toSourceSong', () => {
  it('strips browser or session-only fields but keeps section flow', () => {
    const source = {
      ...song(),
      flow: [0],
      simplifiedSections: [{ type: 'Verse' as const, label: 'Verse 1', lines: [] }],
      simplifiedFlow: [0],
      customSections: [],
      targetKey: 'D',
      body: 'lyrics',
    }
    const cached = toSourceSong(source as Song)
    expect(cached).not.toHaveProperty('customSections')
    expect(cached).not.toHaveProperty('targetKey')
    expect(cached).not.toHaveProperty('body')
    expect(cached.flow).toEqual([0])
    expect(cached.simplifiedFlow).toEqual([0])
  })
})

describe('ChartCache', () => {
  it('maps the requested URL to the validated final URL', async () => {
    const { store } = memoryStore()
    const cache = new ChartCache({ store, now: () => 1_000 })
    const final = 'https://pnwchords.com/good-grace-final'

    await cache.save('https://pnwchords.com/good-grace', song(final))

    expect(await cache.get('https://pnwchords.com/good-grace')).toMatchObject({
      sourceUrl: final,
      title: 'Good Grace',
    })
    expect(store.setAlias).toHaveBeenCalledTimes(1)
  })

  it('expires chart and alias entries explicitly', async () => {
    const { store } = memoryStore()
    let now = 1_000
    const cache = new ChartCache({
      store,
      now: () => now,
      chartTtlMs: 100,
      aliasTtlMs: 50,
    })
    await cache.save('https://pnwchords.com/old', song('https://pnwchords.com/new'))

    now = 1_051
    expect(await cache.get('https://pnwchords.com/old')).toBeNull()
    now = 1_101
    expect(await cache.get('https://pnwchords.com/new')).toBeNull()
  })

  it('ignores charts from a stale parser/schema version', async () => {
    const { store, charts } = memoryStore()
    const now = 1_000
    charts.set('https://pnwchords.com/good-grace', {
      v: 1,
      parserVersion: 'chart-v1',
      canonicalUrl: 'https://pnwchords.com/good-grace',
      song: song(),
      expiresAt: now + 10_000,
    })
    const cache = new ChartCache({ store, now: () => now, parserVersion: 'chart-v2' })
    expect(await cache.get('https://pnwchords.com/good-grace')).toBeNull()
  })

  it('rejects cache reads for non-allow-listed URLs', async () => {
    const { store } = memoryStore()
    const cache = new ChartCache({ store })
    expect(await cache.get('https://evil.example/song')).toBeNull()
  })

  it('skips documents above the bounded size', async () => {
    const { store } = memoryStore()
    const cache = new ChartCache({ store })
    const huge = song()
    huge.sections = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'x'.repeat(800_000), chords: [] }],
      },
    ]
    await cache.save('https://pnwchords.com/huge', huge)
    expect(store.setChart).not.toHaveBeenCalled()
  })
})

describe('loadSourceChart', () => {
  it('coalesces identical concurrent scrapes and caches the source chart', async () => {
    const { store } = memoryStore()
    const cache = new ChartCache({ store, now: () => 1_000 })
    const html = readFileSync(
      new URL('./adapters/__fixtures__/pnwchords.html', import.meta.url),
      'utf8'
    )
    let resolveFetch!: (value: { text: string; finalUrl: string }) => void
    const fetchFn = vi.fn(
      () =>
        new Promise<{ text: string; finalUrl: string }>((resolve) => {
          resolveFetch = resolve
        })
    )
    const url = 'https://pnwchords.com/good-grace'

    const first = loadSourceChart(url, { cache, fetchFn })
    const second = loadSourceChart(url, { cache, fetchFn })
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    resolveFetch({ text: html, finalUrl: url })

    const [a, b] = await Promise.all([first, second])
    expect(a.id).toBe(b.id)
    expect(store.setChart).toHaveBeenCalledTimes(1)

    const cached = await loadSourceChart(url, { cache, fetchFn })
    expect(cached.id).toBe(a.id)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
