import type { Song } from './types.js'
import { loadSourceChart } from './chartLoader.js'
import {
  HostConcurrencyGate,
  RateLimiterAndCircuitBreaker,
  hostGate,
  rateLimiter,
} from './rateLimit.js'
import { runWorkerPool } from './pool.js'

export type ScrapeResult =
  | { url: string; status: 'ok'; song: Song }
  | { url: string; status: 'error'; code: string; message: string }

export const SCRAPE_CONCURRENCY = 2
export const SCRAPE_HOST_CONCURRENCY = 2

export interface ScrapePoolDeps {
  scrape?: (url: string) => Promise<Song>
  limiter?: RateLimiterAndCircuitBreaker
  gate?: HostConcurrencyGate
  concurrency?: number
  hostLimit?: number
}

/**
 * Scrapes URLs with a continuously filled queue. Results keep input order,
 * failures are isolated, host pauses are honoured, and a shared per-host gate
 * covers simultaneous API requests in this instance.
 */
export async function scrapeUrls(urls: string[], deps: ScrapePoolDeps = {}): Promise<ScrapeResult[]> {
  const scrape = deps.scrape ?? loadSourceChart
  const limiter = deps.limiter ?? rateLimiter
  const gate = deps.gate ?? hostGate
  const hostLimit = deps.hostLimit ?? SCRAPE_HOST_CONCURRENCY

  const outcomes = await runWorkerPool(
    urls,
    async (url): Promise<ScrapeResult> => {
      const host = new URL(url).hostname
      const release = await gate.acquire(host, hostLimit)
      try {
        const pausedCheck = limiter.isHostPaused(host)
        if (pausedCheck.paused) {
          return {
            url,
            status: 'error',
            code: 'HOST_PAUSED',
            message: `Requests to ${host} temporarily paused due to repeated upstream errors. Try again later.`,
          }
        }

        try {
          const song = await scrape(url)
          limiter.recordHostSuccess(host)
          return { url, status: 'ok', song }
        } catch (err) {
          const status = (err as { status?: number })?.status
          limiter.recordHostFailure(host, status)
          return {
            url,
            status: 'error',
            code: (err as { code?: string })?.code || 'SCRAPE_FAILED',
            message: (err as Error).message || 'Failed to extract chords',
          }
        }
      } finally {
        release()
      }
    },
    deps.concurrency ?? SCRAPE_CONCURRENCY
  )

  return outcomes.map((outcome, index) =>
    outcome.ok
      ? outcome.value
      : {
          url: urls[index],
          status: 'error',
          code: 'SCRAPE_FAILED',
          message: (outcome.error as Error)?.message || 'Failed to extract chords',
        }
  )
}
