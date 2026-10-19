/**
 * Reproducible local benchmark with controlled delays.
 *
 * This measures scheduling and parsing overhead only. The "network" is a
 * deterministic timer, so these numbers are SIMULATED and must not be quoted
 * as production latency. Live measurements must be collected separately with
 * `PERF_METRICS` Cloud Logging events.
 *
 * Run with: npm run bench --prefix functions
 */
import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseUgSearchHtml } from '../../src/search/ultimateGuitarSearch.js'
import { parsePnwSearchHtml } from '../../src/search/pnwChordsSearch.js'
import { parseWorshipTogetherSearchHtml } from '../../src/search/worshipTogetherSearch.js'
import { searchSite, searchSites } from '../../src/search/searchSites.js'
import { scrapeUrls } from '../../src/scrapePool.js'
import { HostConcurrencyGate, RateLimiterAndCircuitBreaker } from '../../src/rateLimit.js'
import type { SearchAdapter } from '../../src/search/types.js'
import type { Song } from '../../src/types.js'

process.env.PERF_METRICS = '0'

const SAMPLES = 40
const SITE_DELAYS_MS = [30, 45, 60]

function fixture(name: string): string {
  return readFileSync(new URL(`../search/__fixtures__/${name}`, import.meta.url), 'utf8')
}

const fixtures = {
  'ultimate-guitar': fixture('ug-search.html'),
  pnwchords: `<h2 class="post-title entry-title"><a href="https://pnwchords.com/good-grace/">Good Grace – Hillsong Worship</a></h2>`,
  worshiptogether: `<a href="/songs/holy-forever-chris-tomlin/">Holy Forever</a>`,
}

const adapters: SearchAdapter[] = [
  {
    site: 'ultimate-guitar',
    search: async () => {
      await delay(SITE_DELAYS_MS[0])
      return parseUgSearchHtml(fixtures['ultimate-guitar'])
    },
  },
  {
    site: 'pnwchords',
    search: async () => {
      await delay(SITE_DELAYS_MS[1])
      return parsePnwSearchHtml(fixtures.pnwchords)
    },
  },
  {
    site: 'worshiptogether',
    search: async () => {
      await delay(SITE_DELAYS_MS[2])
      return parseWorshipTogetherSearchHtml(fixtures.worshiptogether)
    },
  },
]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runSequential(): Promise<number> {
  let count = 0
  const limiter = new RateLimiterAndCircuitBreaker()
  for (const adapter of adapters) {
    const outcome = await searchSite(adapter, 'good grace', { limiter })
    count += outcome.candidates.length
  }
  return count
}

async function runConcurrent(): Promise<number> {
  const { candidates } = await searchSites(adapters, 'good grace', {
    limiter: new RateLimiterAndCircuitBreaker(),
  })
  return candidates.length
}

const IMPORT_SCALE = 0.1

async function fixedBatches(durations: number[], concurrency: number): Promise<void> {
  for (let offset = 0; offset < durations.length; offset += concurrency) {
    const batch = durations.slice(offset, offset + concurrency)
    await Promise.all(batch.map((durationMs) => delay(durationMs * IMPORT_SCALE)))
  }
}

function benchmarkSong(url: string): Song {
  return {
    id: url,
    title: 'Benchmark Song',
    artist: 'Artist',
    sourceUrl: url,
    sourceSite: 'pnwchords',
    originalKey: 'G',
    sections: [],
  }
}

async function workerPool(durations: number[], concurrency: number): Promise<void> {
  const urls = durations.map((_, index) => `https://pnwchords.com/${index}`)
  await scrapeUrls(urls, {
    concurrency,
    hostLimit: concurrency,
    gate: new HostConcurrencyGate(),
    limiter: new RateLimiterAndCircuitBreaker(),
    scrape: async (url) => {
      const index = Number(new URL(url).pathname.split('/').pop())
      await delay(durations[index] * IMPORT_SCALE)
      return benchmarkSong(url)
    },
  })
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function summary(values: number[]) {
  return {
    samples: values.length,
    median_ms: Number(percentile(values, 50).toFixed(2)),
    p95_ms: Number(percentile(values, 95).toFixed(2)),
  }
}

async function measure(run: () => Promise<number>): Promise<number[]> {
  const samples: number[] = []
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = performance.now()
    await run()
    samples.push(performance.now() - started)
  }
  return samples
}

describe('simulated search and import scheduling', () => {
  it('records sequential vs concurrent search scheduling', async () => {
    const sequential = await measure(runSequential)
    const concurrent = await measure(runConcurrent)
    console.log(
      JSON.stringify({
        benchmark: 'search-scheduling',
        mode: 'SIMULATED (controlled timers, fixture parsers)',
        sequential: summary(sequential),
        concurrent: summary(concurrent),
      })
    )
  })

  it('records fixed-batch vs worker-pool import completion', async () => {
    const durations = [120, 15, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
    const fixed: number[] = []
    const pooled: number[] = []
    for (let sample = 0; sample < 12; sample += 1) {
      let started = performance.now()
      await fixedBatches(durations, 2)
      fixed.push(performance.now() - started)
      started = performance.now()
      await workerPool(durations, 2)
      pooled.push(performance.now() - started)
    }
    console.log(
      JSON.stringify({
        benchmark: 'import-scheduling',
        mode: 'SIMULATED (controlled durations, no network)',
        songs: durations.length,
        concurrency: 2,
        fixed_batches: summary(fixed),
        worker_pool: summary(pooled),
      })
    )
  })
})
