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

const parsers = [
  () => parseUgSearchHtml(fixtures['ultimate-guitar']),
  () => parsePnwSearchHtml(fixtures.pnwchords),
  () => parseWorshipTogetherSearchHtml(fixtures.worshiptogether),
]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runSequential(): Promise<number> {
  const counts: number[] = []
  for (let i = 0; i < parsers.length; i += 1) {
    await delay(SITE_DELAYS_MS[i])
    counts.push(parsers[i]().length)
  }
  return counts.reduce((sum, count) => sum + count, 0)
}

async function runConcurrent(): Promise<number> {
  const results = await Promise.all(
    parsers.map(async (parse, index) => {
      await delay(SITE_DELAYS_MS[index])
      return parse().length
    })
  )
  return results.reduce((sum, count) => sum + count, 0)
}

const IMPORT_SCALE = 0.1

async function fixedBatches(durations: number[], concurrency: number): Promise<void> {
  for (let offset = 0; offset < durations.length; offset += concurrency) {
    const batch = durations.slice(offset, offset + concurrency)
    await Promise.all(batch.map((durationMs) => delay(durationMs * IMPORT_SCALE)))
  }
}

async function workerPool(durations: number[], concurrency: number): Promise<void> {
  const queue = [...durations]
  const worker = async () => {
    while (queue.length > 0) {
      const durationMs = queue.shift()!
      await delay(durationMs * IMPORT_SCALE)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
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
